import { TestBed } from '@angular/core/testing';

import { Meeting } from './meeting';

describe('Meeting', () => {
  let service: Meeting;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Meeting);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
