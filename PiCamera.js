"use strict";

var CameraName = "Pi Camera";
var CameraManufacturer = "Raspberry Pi";
var CameraModel = "HD Camera Board V2";
var CameraSerialNumber = "BGR2N67BHSEASF8812";
var CameraFirmwareRevision = "1.0.0";

var CameraUserName = "AA:BA:CA:AC:AB:AA";
var CameraPort = 51062;
var CameraPinCode = "391-89-194";

var storage = require("node-persist");
var uuid = require("hap-nodejs").uuid;
var Service = require("hap-nodejs").Service;
var Characteristic = require("hap-nodejs").Characteristic;
var Accessory = require("hap-nodejs").Accessory;
var Camera = require("hap-nodejs").Camera;

const spawn = require("child_process").spawn;
const kill = require("tree-kill");
var fs = require("fs");

console.log("HAP-NodeJS starting...");

//Initialize our storage system
storage.initSync();
console.log("Storage system initialized...");

// Since we are hosting independent accessoris start by creating a camera accessory.
var cameraUUID = uuid.generate(CameraName);
console.log(CameraName + " UUID is: " + cameraUUID);

var cameraAccessory = new Accessory(CameraName, cameraUUID);

//set the charachteristics
cameraAccessory
  .getService(Service.AccessoryInformation)
  .setCharacteristic(Characteristic.Manufacturer, CameraManufacturer)
  .setCharacteristic(Characteristic.Model, CameraModel)
  .setCharacteristic(Characteristic.SerialNumber, CameraSerialNumber)
  .setCharacteristic(Characteristic.FirmwareRevision, CameraFirmwareRevision);
console.log(CameraName + " (camera accessory) initialized...");

var cameraSource = new Camera();

Camera.prototype.handleSnapshotRequest = function (request, callback) {
  var width = request["width"];
  var height = request["height"];

  const libcamerastillOptions = [
    '--width', `${width}`, 
    '--height', `${height}`,
    '--autofocus',
    '-n',
    '-o', './snapshots/snapshot.jpg'
  ];

  console.log(`Start: Snapshot`);
  let stillProcess = spawn('sh', ['-c', `libcamera-still ${libcamerastillOptions.join(' ')}`], {env: process.env});
  stillProcess.on('exit', (code) => {
    if (code === 0) {
      fs.readFile(__dirname + "/snapshots/snapshot.jpg", function(err, data) {
        callback("", data);
        console.log(`End: Snapshot`);
      });
    } else {
      callback(stderr, undefined);
      console.log(`Failed: Snapshot`);
    }
  });
}

Camera.prototype.handleStreamRequest = function (request) {
  var sessionID = request["sessionID"];
  var requestType = request["type"];
  if (sessionID) {
    let sessionIdentifier = uuid.unparse(sessionID);

    if (requestType == "start") {
      var sessionInfo = this.pendingSessions[sessionIdentifier];
      if (sessionInfo) {
        let targetAddress = sessionInfo['address'];
        let targetVideoPort = sessionInfo['video_port'];
        let videoKey = sessionInfo['video_srtp'];
        let videoSSRC = sessionInfo['video_ssrc'];

        let videoInfo = request["video"];
        let width = videoInfo["width"];
        let height = videoInfo["height"];
        let fps = videoInfo["fps"];
        let bitrate = videoInfo["max_bit_rate"];

        let url = `srtp://${targetAddress}:${targetVideoPort}?rtcpport=${targetVideoPort}&localrtcpport=${targetVideoPort}&pkt_size=1378`;

        const libcameravidOptions = [
          '-o', '-',
          '-t', '0',
          '-g', `${fps}`,
          '--width', `${width}`, 
          '--height', `${height}`,
          '--autofocus',
          '-n'
        ];

        const ffmpegOptions = [
          '-hide_banner',
          '-re',
          '-f', 'h264',
          '-i', 'pipe:0',
          '-s', `${width}:${height}`,
          '-vcodec', 'copy',
          '-tune', 'zerolatency',
          '-b:v', `${bitrate}k`,
          '-bufsize', `${2 * bitrate}k`,
          '-payload_type', '99',
          '-ssrc', `${videoSSRC}`,
          '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
          '-srtp_out_params', videoKey.toString('base64'),
          '-f', 'rtp',
          `\"${url}\"`
        ];

        console.log(`Start: Video ${videoSSRC}`);
        let videoProcess = spawn('sh', ['-c', `libcamera-vid ${libcameravidOptions.join(' ')} | ffmpeg ${ffmpegOptions.join(' ')}`], {env: process.env});
        videoProcess.on('exit', (code) => {
          console.log(`Stop: Video ${videoSSRC}`);
        });

        this.ongoingSessions[sessionIdentifier] = videoProcess;
      }
      delete this.pendingSessions[sessionIdentifier];
    } else if (requestType == "stop") {
      if (this.ongoingSessions[sessionIdentifier]) {
        var videoProcess = this.ongoingSessions[sessionIdentifier];
        kill(videoProcess.pid);

        delete this.ongoingSessions[sessionIdentifier];
      }
    }
  }
}

//set the camera accessory source.
cameraAccessory.configureCameraSource(cameraSource);
console.log("Camera source configured...");

//hook up events.
cameraAccessory.on("identify", function (paired, callback) {
  console.log(CameraName + " identify invoked...");
  callback(); // success
});

// Publish the camera on the local network.
cameraAccessory.publish({
  username: CameraUserName,
  port: CameraPort,
  pincode: CameraPinCode,
  category: Accessory.Categories.CAMERA
}, true);
