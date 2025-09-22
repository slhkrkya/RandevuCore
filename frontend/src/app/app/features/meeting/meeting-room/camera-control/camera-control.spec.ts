import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CameraControl } from './camera-control';

describe('CameraControl', () => {
  let component: CameraControl;
  let fixture: ComponentFixture<CameraControl>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CameraControl]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CameraControl);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
