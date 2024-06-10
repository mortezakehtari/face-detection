import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, computed, input, model, output, signal, viewChild } from '@angular/core';
import * as faceapi from 'face-api.js';
import { FaceDetection } from 'face-api.js';
import Image from 'image-js';
import { NgClass } from '@angular/common';
import { ERROR_TYPE } from './error-type.model';

//thresholds can be set here
const scoreThreshold = 0.9; //face visibility
const errorMargin = 1.5; //face in ellipse
const tiltThreshold = 10; // Maximum allowed tilt angle in degrees
const verticalThreshold = 50; // Maximum allowed vertical misalignment in pixels
const yawThreshold = 0.5; // Threshold for determining significant yaw rotation
const headTiltUpOrDownThreshold = 0.3; // Threshold for determining significant tilt up or down
const lightThreshold = 80; //Threshold for light
const contrastThreshold = 30; //Threshold for contrast

@Component({
  selector: 'app-face-detector',
  standalone: true,
  imports: [NgClass],
  templateUrl: './face-detector.component.html',
  styleUrl: './face-detector.component.scss'
})

export class FaceDetectorComponent implements AfterViewInit, OnDestroy {
  enabledCaptureButton = model(false);

  context = signal<any>('');
  interval = signal<any>('');;
  errors = model<ERROR_TYPE[]>([])
  loading = model(true);

  // video
  isPauseVideo = model(false)
  videoRecordStatus = model<'timerBeforeRecord' | 'recording' | 'endRecorded' | null>(null)
  processTimerRecordingVideo = input<number>(5)

  processTimerBeforTakeVideo = input<number>(3)
  _processTimerBeforTakeVideo = signal(this.processTimerBeforTakeVideo())

  videoElement = viewChild.required<ElementRef<HTMLVideoElement>>('videoElement')
  canvasElement = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasElement')

  #videoElement = computed(() => this.videoElement().nativeElement)
  #canvasElement = computed(() => this.canvasElement().nativeElement)

  behaviorCapture = input<'video' | 'photo'>('photo')
  isVideoCapture = computed(() => this.behaviorCapture() == "video")

  captured = model(false);
  errorMapper = signal<{ [key: string]: { errorTitle: string, errorMessage: string } }>({
    lowLight: { errorTitle: 'نور کافی نیست', errorMessage: 'لطفا به مکانی با نور روشن تر بروید' },
    tooFar: { errorTitle: 'صورت شما خیلی دور است', errorMessage: 'لطفا به دوربین نزدیک تر شوید.' },
    outOfBox: {
      errorTitle: 'صورت شما در کادر نیست',
      errorMessage: 'لطفا صورت خود را داخل کادر قرار دهید'
    },
    horizontalTilt: {
      errorTitle: 'صورت شما به چپ یا راست متمایل است',
      errorMessage: 'لطفا صورت خود صاف و در مقابل دوربین قرار دهید'
    },
    verticalTilt: {
      errorTitle: 'صورت شما به بالا یا پایین متمایل است',
      errorMessage: 'لطفا صورت خود صاف و در مقابل دوربین قرار دهید'
    },
    yawRotate: {
      errorTitle: 'صورت شما به چپ یا راست خم شده ‌است.',
      errorMessage: 'لطفا صورت خود صاف و در مقابل دوربین قرار دهید'
    },
    faceVisibility: {
      errorTitle: 'شیئی جلوی صورتتان است',
      errorMessage: 'لطفا شیء را از جلوی صورتتان بردارید'
    }
  });
  isEnableBtn = output<boolean>()
  capturedFile = output<string>()

  async ngAfterViewInit() {
    await faceapi.nets.tinyFaceDetector.loadFromUri('/assets/models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('/assets/models');
    this.isEnableBtn.emit(false)
    setTimeout(() => {
      this.loading.set(false);
      this.initCamera();
    }, 2000);
  }

  ngOnDestroy() {
    if (this.interval()) {
      clearInterval(this.interval());
    }
  }

  initCapture() {
    clearInterval(this.interval());
    this.isEnableBtn.emit(false)
    if (this.isVideoCapture()) this.startTimerForVideo();
    else this.takePhoto();
  }

  initCamera() {
    this.context.set(this.#canvasElement().getContext('2d'))
    this.#videoElement().muted = true;
    this.#videoElement().playsInline = true;
    this.#videoElement().autoplay = true;

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        this.#videoElement().srcObject = stream;
        this.#videoElement().play();
        this.captureValidate()
      })
      .catch((err) => {
        console.error('Error accessing camera: ', err);
      });

    if (this.isVideoCapture()) {
      this.#videoElement().addEventListener("pause", () => {
        this.isPauseVideo.set(true)
      })
    }

  }

  captureValidate() {
    this.interval.set(setInterval(async () => {
      this.#canvasElement().width = this.#videoElement().videoWidth;
      this.#canvasElement().height = this.#videoElement().videoHeight;
      this.context()?.setTransform(-1, 0, 0, 1, this.#canvasElement().width, 0); // Flip horizontally
      this.context()?.drawImage(this.#videoElement(), 0, 0, this.#canvasElement().width, this.#canvasElement().height);
      this.context()?.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

      const ellipseDimensions = this.calculateEllipseDimensions(this.#videoElement());

      this.drawEllipse(
        this.context() as CanvasRenderingContext2D,
        ellipseDimensions.x,
        ellipseDimensions.y,
        ellipseDimensions.width,
        ellipseDimensions.height
      );

      this.enabledCaptureButton.set(await this.processImage(this.#canvasElement()))
      this.isEnableBtn.emit(this.enabledCaptureButton());
    }, 1000)) // Adjust the interval as needed)
  }

  takePhoto() {
    this.context()?.setTransform(
      -1,
      0,
      0,
      1,
      this.#canvasElement().width,
      0
    ); // Flip horizontally
    this.context()?.drawImage(
      this.videoElement().nativeElement,
      0,
      0,
      this.#canvasElement().width,
      this.#canvasElement().height
    );
    this.context()?.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    const dataUrl = this.#canvasElement().toDataURL('image/png');


    this.#canvasElement().toBlob((blob) => {
      const url = URL.createObjectURL(blob as Blob);
      this.#videoElement().autoplay = false
      this.#videoElement().srcObject = null
      this.#videoElement().style.transform = "none";
      this.#videoElement().poster = url;
    })

    this.capturedFile.emit(dataUrl);
    this.captured.set(true)
  }

  startTimerForVideo() {
    this.videoRecordStatus.set('timerBeforeRecord')
    let interval = setInterval(() => {
      this._processTimerBeforTakeVideo.update((value) => value - 1)
      if (this._processTimerBeforTakeVideo() == 0) {
        clearInterval(interval)
        this.startRecordingVideo()
      }
    }, 1000)
  }

  startRecordingVideo() {

    const mediaRecorder = new MediaRecorder(this.#videoElement().srcObject as MediaStream);
    const chunks: Blob[] = [];

    mediaRecorder.ondataavailable = function (e) {
      chunks.push(e.data);
    };

    mediaRecorder.start();
    this.videoRecordStatus.set('recording')

    setTimeout(() => {
      mediaRecorder.stop();
      this.videoRecordStatus.set('endRecorded')
      this.isPauseVideo.set(true)
    }, this.processTimerRecordingVideo() * 1000)

    // listener on stop recording  
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { 'type': 'video/mp4' });
      const videoURL = URL.createObjectURL(blob);
      this.#videoElement().srcObject = null
      this.#videoElement().autoplay = false
      this.#videoElement().src = videoURL;
      this.capturedFile.emit(videoURL);
      this.captured.set(true)
    };
  }

  playRecordedVideo() {
    this.isPauseVideo.set(false)
    this.#videoElement().play()
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

      return isInEllipse && isHeadStraight && isLandMarkValid && isFaceVisibility;
    }
    return false;
  }

  calculateEllipseDimensions(video: HTMLVideoElement) {
    const width = video.videoWidth;
    const height = video.videoHeight;

    const ellipseWidth = width * 0.4; // 50% of the video width
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
    if (this.errors().indexOf(errorType) === -1) {
      this.errors.update((error) => [...error, errorType]);
    }
  }

  removeErrorMessage(errorType: ERROR_TYPE) {
    this.errors.set(this.errors().filter((error) => error !== errorType))
  }
}

