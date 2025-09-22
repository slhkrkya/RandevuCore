import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ScreenShare } from './screen-share';

describe('ScreenShare', () => {
  let component: ScreenShare;
  let fixture: ComponentFixture<ScreenShare>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScreenShare]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ScreenShare);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
