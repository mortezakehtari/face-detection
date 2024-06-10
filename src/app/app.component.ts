import { Component, model, viewChild } from '@angular/core';
import { FaceDetectorComponent } from './face-detector/face-detector.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FaceDetectorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  btnDisable = model<boolean>(false)

  faceDetector = viewChild.required<FaceDetectorComponent>(FaceDetectorComponent)

  statusChange(event: boolean) {
    this.btnDisable.set(!event)
  }

  startingVideo() {
    this.faceDetector().initCapture()
  }

}
