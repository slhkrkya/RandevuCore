import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VideoGrid } from './video-grid';

describe('VideoGrid', () => {
  let component: VideoGrid;
  let fixture: ComponentFixture<VideoGrid>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VideoGrid]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VideoGrid);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
