import BN from 'bn.js';
import Docker from 'dockerode';
import web3Utils from 'web3-utils';
import msgpack from 'msgpack-lite';
import EthCrypto from 'eth-crypto';
import utils from '../src/enigma-utils';

const docker = new Docker();
exports.execInContainer = (enigma, commandOption, resetEpochState = false) => {
  let container = docker.getContainer(process.env.PRINCIPAL_CONTAINER);
  return new Promise((resolve, reject) => {
    const contractAddress = enigma.enigmaContract.options.address.substring(2);
    const epochStateOption = (resetEpochState) ? '-s' : '';
    const cmd = ['bash', '-c', `./enigma-principal-app ${commandOption} ${epochStateOption} -c ${contractAddress}`];
    const cmdStr = cmd.join(' ');
    console.log('Calling:\n', cmdStr);
    container.exec(
      {
        Cmd: cmd,
        AttachStdin: true,
        AttachStdout: true,
        WorkingDir: '/root/src/enigma-principal/bin',
      }, (err, exec) => {
        exec.start({hijack: true, stdin: true}, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          let out = '';
          stream.on('data', (line) => {
            out += line;
          });
          stream.on('error', (err) => {
            out += err;
          });
          stream.on('end', () => {
            const txFrom = out.lastIndexOf('0x');
            const txLen = out.length - txFrom;
            console.log(`Called cmd ${cmdStr}:\n${out}`);
            if (txLen === 67) {
              const tx = out.substr(txFrom);
              resolve(tx);
            } else {
              reject(`Unable to call command ${commandOption} from the Principal node container: ${out}`);
            }
          });
        });
      });
  });
};

exports.getStateKeysInContainer = (enigma, worker, scAddrs) => {
  let container = docker.getContainer(process.env.PRINCIPAL_CONTAINER);
  const identity = EthCrypto.createIdentity();
  const pubkey = web3Utils.hexToBytes(`0x${identity.publicKey}`);
  const prefix = 'Enigma Message'.split('').map((c) => c.charCodeAt(0));
  const id = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  const request = {
    prefix: prefix,
    data: {Request: scAddrs.map((a) => web3Utils.hexToBytes(a))},
    pubkey: pubkey,
    id: id,
  };
  console.log('The JSON request', JSON.stringify(request));
  const buffer = msgpack.encode(request);
  const msg = buffer.toString('hex');
  // TODO: Where does 40 come from?
  let image = (new BN(40)).toString(16, 16);
  for (let val of scAddrs) {
    val = utils.remove0x(val);
    // since the inputs are in hex string, they are twice as long as their bytes
    image += (new BN(val.length / 2).toString(16, 16)) + val;
  }
  for (let val of [pubkey, id]) {
    val = utils.remove0x(web3Utils.bytesToHex(val));
    // since the inputs are in hex string, they are twice as long as their bytes
    image += (new BN(val.length / 2).toString(16, 16)) + val;
  }
  let rawImage = web3Utils.hexToBytes(`0x${image}`);
  console.log('The image:', rawImage);
  const signature = EthCrypto.sign(worker[4], web3Utils.soliditySha3({
    t: 'bytes',
    value: image,
  }));
  const params = JSON.stringify([msg, utils.remove0x(signature)]);
  console.log('The getStateKeys params:', params);
  return new Promise((resolve, reject) => {
    const contractAddress = enigma.enigmaContract.options.address.substring(2);
    const cmd = ['bash', '-c', `./enigma-principal-app -k '${params}' -c ${contractAddress}`];
    const cmdStr = cmd.join(' ');
    console.log('Calling:\n', cmdStr);
    container.exec(
      {
        Cmd: cmd,
        AttachStdin: true,
        AttachStdout: true,
        WorkingDir: '/root/src/enigma-principal/bin',
      }, (err, exec) => {
        exec.start({hijack: true, stdin: true}, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          let out = '';
          stream.on('data', (line) => {
            out += line;
          });
          stream.on('error', (err) => {
            out += err;
          });
          stream.on('end', () => {
            console.log(`Called cmd ${cmdStr}:\n${out}`);
            const from = out.lastIndexOf('{"data"');
            if (from != -1) {
              const response = JSON.parse(out.substr(from));
              const data = msgpack.decode(response.data);
              console.log('Got response', response, data);
              resolve(response);
            } else {
              reject(`Unable to setStateKeys from the Principal node container: ${out}`);
            }
          });
        });
      });
  });
};
