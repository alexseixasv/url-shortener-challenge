import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return status ok', () => {
      expect(appController.getStatus()).toEqual({ status: 'ok' });
    });
  });
});
