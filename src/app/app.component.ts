import { Component } from '@angular/core';
import { FaceDetectorComponent } from './face-detector/face-detector.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FaceDetectorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {

}
