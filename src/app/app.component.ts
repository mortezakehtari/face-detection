import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import * as faceapi from 'face-api.js';
import { FaceDetection } from 'face-api.js';
import Image from 'image-js';
import { NgClass, NgSwitch, NgSwitchCase } from '@angular/common';

enum ERROR_TYPE {
  LOW_LIGHT,
  TOO_FAR,
  OUT_OF_BOX,
  HORIZONTAL_TILT,
  VERTICAL_TILT,
  YAW_ROTATE,
  FACE_VISIBILITY,
}

//constants and threshold can be set here
const scoreThreshold = 0.9; //face visibility
const errorMargin = 1.5; //face in ellipse
const tiltThreshold = 10; // Maximum allowed tilt angle in degrees
const yawThreshold = 0.5; // Threshold for determining significant yaw rotation
const headTiltUpOrDownThreshold = 0.3; // Threshold for determining significant tilt up or down

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgClass, NgSwitch, NgSwitchCase],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements AfterViewInit {
  enabledCaptureButton = false;
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;
  context!: any;
  messages: ERROR_TYPE[] = [];
  protected readonly ERROR_TYPE = ERROR_TYPE;

  async ngAfterViewInit() {
    await faceapi.nets.tinyFaceDetector.loadFromUri('/assets/models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('/assets/models');
    this.initCamera();
  }

  initCamera() {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    this.context = canvas.getContext('2d');

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        video.srcObject = stream;
        video.play();
      })
      .catch((err) => {
        console.error('Error accessing camera: ', err);
      });

    video.addEventListener('play', () => {
      const interval = setInterval(async () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        this.context?.setTransform(-1, 0, 0, 1, canvas.width, 0); // Flip horizontally
        this.context?.drawImage(video, 0, 0, canvas.width, canvas.height);
        this.context?.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

        const ellipseDimensions = this.calculateEllipseDimensions(video);

        this.drawEllipse(
          this.context as CanvasRenderingContext2D,
          ellipseDimensions.x,
          ellipseDimensions.y,
          ellipseDimensions.width,
          ellipseDimensions.height
        );

        this.enabledCaptureButton = await this.processImage(canvas);
      }, 500); // Adjust the interval as needed
    });
  }

  capture() {
    this.context?.setTransform(
      -1,
      0,
      0,
      1,
      this.canvasElement.nativeElement.width,
      0
    ); // Flip horizontally
    this.context?.drawImage(
      this.videoElement.nativeElement,
      0,
      0,
      this.canvasElement.nativeElement.width,
      this.canvasElement.nativeElement.height
    );
    this.context?.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    const dataUrl = this.canvasElement.nativeElement.toDataURL('image/png');
  }

  drawEllipse(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    context.beginPath();
    context.ellipse(x, y, width / 2, height / 2, 0, 0, 2 * Math.PI);
    context.lineWidth = 2;
    context.strokeStyle = 'red';
    context.stroke();
  }

  async processImage(canvas: HTMLCanvasElement): Promise<boolean> {
    const img = await Image.load(canvas.toDataURL());
    const grey = img.grey();
    const histogram = grey.getHistogram();

    let mean = 0,
      stdDev = 0;
    for (let i = 0; i < histogram.length; i++) {
      mean += i * histogram[i];
    }
    mean /= grey.size;

    for (let i = 0; i < histogram.length; i++) {
      stdDev += Math.pow(i - mean, 2) * histogram[i];
    }
    stdDev = Math.sqrt(stdDev / grey.size);

    const lightThreshold = 100;
    const contrastThreshold = 50;

    if (mean <= lightThreshold || stdDev <= contrastThreshold) {
      this.addErrorMessage(ERROR_TYPE.LOW_LIGHT);
      return false;
    }
    this.removeErrorMessage(ERROR_TYPE.LOW_LIGHT);

    const detection = await faceapi
      .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks();
    if (detection) {
      const box = detection.detection.box;
      const landmarks = detection.landmarks;
      const expectedEllipse = {
        x: canvas.width / 2,
        y: canvas.height / 2,
        width: 200,
        height: 300,
      };
      const isInEllipse = this.isFaceInEllipse(box, expectedEllipse);
      const isHeadStraight = this.isHeadStraight(landmarks);
      const isLandMarkValid = this.areLandmarksValid(landmarks);
      const isFaceVisibility = this.isFaceVisible(detection.detection);

      return (
        isInEllipse && isHeadStraight && isLandMarkValid && isFaceVisibility
      );
    }
    return false;
  }

  calculateEllipseDimensions(video: HTMLVideoElement) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    console.log(video.videoWidth, video.videoHeight);

    const ellipseWidth = width * 0.5; // 50% of the video width
    const ellipseHeight = height * 0.75; // 75% of the video height

    return {
      x: width / 2,
      y: height / 2,
      width: ellipseWidth,
      height: ellipseHeight,
    };
  }

  isFaceVisible(detection: FaceDetection): boolean {
    if (detection.score <= scoreThreshold) {
      this.addErrorMessage(ERROR_TYPE.FACE_VISIBILITY);
      return false;
    }
    this.removeErrorMessage(ERROR_TYPE.FACE_VISIBILITY);
    return true;
  }

  areLandmarksValid(landmarks: any) {
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();

    if (!leftEye.length || !rightEye.length) {
      this.addErrorMessage(ERROR_TYPE.FACE_VISIBILITY);
    } else {
      this.removeErrorMessage(ERROR_TYPE.FACE_VISIBILITY);
    }

    return leftEye.length > 0 && rightEye.length > 0;
  }

  isFaceInEllipse(faceBox: any, ellipse: any) {
    // Increase ellipse dimensions by 15%

    const a = (ellipse.width / 2) * errorMargin;
    const b = (ellipse.height / 2) * errorMargin;
    const h = ellipse.x;
    const k = ellipse.y;

    const corners = [
      { x: faceBox.x, y: faceBox.y }, // Top-left
      { x: faceBox.x + faceBox.width, y: faceBox.y }, // Top-right
      { x: faceBox.x, y: faceBox.y + faceBox.height }, // Bottom-left
      { x: faceBox.x + faceBox.width, y: faceBox.y + faceBox.height }, // Bottom-right
    ];

    // Check if all corners are within the ellipse
    const isInEllipse = corners.every((corner) => {
      const value =
        Math.pow(corner.x - h, 2) / Math.pow(a, 2) +
        Math.pow(corner.y - k, 2) / Math.pow(b, 2);
      return value <= 1;
    });

    // Additional check: ensure the face size is within an acceptable range
    const faceWidth = faceBox.width;
    const faceHeight = faceBox.height;
    const minFaceWidth = ellipse.width / 2; // Minimum acceptable face width
    const minFaceHeight = ellipse.height / 2; // Minimum acceptable face height
    const isFaceSizeAcceptable =
      faceWidth >= minFaceWidth && faceHeight >= minFaceHeight;

    if (!isInEllipse) {
      this.addErrorMessage(ERROR_TYPE.OUT_OF_BOX);
    } else {
      this.removeErrorMessage(ERROR_TYPE.OUT_OF_BOX);
    }
    if (!isFaceSizeAcceptable) {
      this.addErrorMessage(ERROR_TYPE.TOO_FAR);
    } else {
      this.removeErrorMessage(ERROR_TYPE.TOO_FAR);
    }
    return isInEllipse && isFaceSizeAcceptable;
  }

  isHeadStraight(landmarks: any) {
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    const noseTip = landmarks.getNose()[3];
    const mouth = landmarks.getMouth();

    const leftEyeCenter = {
      x: (leftEye[0].x + leftEye[3].x) / 2,
      y: (leftEye[1].y + leftEye[5].y) / 2,
    };
    const rightEyeCenter = {
      x: (rightEye[0].x + rightEye[3].x) / 2,
      y: (rightEye[1].y + rightEye[5].y) / 2,
    };
    const mouthCenter = {
      x: (mouth[0].x + mouth[6].x) / 2,
      y: (mouth[3].y + mouth[9].y) / 2,
    };

    // Calculate horizontal tilt angle between the eyes
    const deltaY = rightEyeCenter.y - leftEyeCenter.y;
    const deltaX = rightEyeCenter.x - leftEyeCenter.x;
    const eyeAngle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    // Check if eyes are horizontally aligned within the threshold
    const isHorizontallyStraight = Math.abs(eyeAngle) <= tiltThreshold;

    // Calculate the vertical alignment
    const verticalDistEyes = Math.abs(leftEyeCenter.y - rightEyeCenter.y);
    const verticalDistEyesNose = Math.abs(
      (leftEyeCenter.y + rightEyeCenter.y) / 2 - noseTip.y
    );
    const verticalDistNoseMouth = Math.abs(noseTip.y - mouthCenter.y);

    const verticalThreshold = 50; // Maximum allowed vertical misalignment in pixels

    // Ensure the head is not tilted up or down significantly
    // const noseToEyesMidpointY = (leftEyeCenter.y + rightEyeCenter.y) / 2;
    const noseToMouthY = Math.abs(noseTip.y - mouthCenter.y);

    const avgEyeNoseMouthRatio = verticalDistEyesNose / noseToMouthY;

    const isVerticallyStraight =
      verticalDistEyes <= verticalThreshold &&
      verticalDistNoseMouth <= verticalThreshold &&
      Math.abs(avgEyeNoseMouthRatio - 1) <= headTiltUpOrDownThreshold;

    // Calculate the horizontal distance between the eyes and nose
    const noseToLeftEyeX = Math.abs(noseTip.x - leftEyeCenter.x);
    const noseToRightEyeX = Math.abs(noseTip.x - rightEyeCenter.x);

    // Ensure the head is not rotated left or right significantly
    const isYawStraight =
      Math.abs(noseToLeftEyeX - noseToRightEyeX) <=
      yawThreshold * Math.min(noseToLeftEyeX, noseToRightEyeX);

    if (!isHorizontallyStraight) {
      this.addErrorMessage(ERROR_TYPE.HORIZONTAL_TILT);
    } else {
      this.removeErrorMessage(ERROR_TYPE.HORIZONTAL_TILT);
    }

    if (!isVerticallyStraight) {
      this.addErrorMessage(ERROR_TYPE.VERTICAL_TILT);
    } else {
      this.removeErrorMessage(ERROR_TYPE.VERTICAL_TILT);
    }

    if (!isYawStraight) {
      this.addErrorMessage(ERROR_TYPE.YAW_ROTATE);
    } else {
      this.removeErrorMessage(ERROR_TYPE.YAW_ROTATE);
    }
    return isHorizontallyStraight && isVerticallyStraight && isYawStraight;
  }

  addErrorMessage(errorType: ERROR_TYPE) {
    if (this.messages.indexOf(errorType) === -1) {
      this.messages.push(errorType);
    }
  }

  removeErrorMessage(errorType: ERROR_TYPE) {
    this.messages = this.messages.filter((error) => error !== errorType);
  }
}
