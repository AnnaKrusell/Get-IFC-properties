import { TestBed } from '@angular/core/testing';

import { ModelAddService } from './model-add.service';

describe('ModelAddService', () => {
  let service: ModelAddService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ModelAddService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
