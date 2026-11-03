import { Logger } from '@nestjs/common';
import { OcrService } from './ocr.service';
const mockDetection = jest.fn();
jest.mock('@google-cloud/vision', () => ({
  ImageAnnotatorClient: jest
    .fn()
    .mockImplementation(() => ({ documentTextDetection: mockDetection })),
}));
describe('Original packaging OCR', () => {
  beforeEach(() => {
    mockDetection.mockReset();
  });
  it('returns original text and line breaks without translation', async () => {
    const text = '보습 크림\nСостав: Aqua\nHajmi: 50 ml';
    mockDetection.mockResolvedValueOnce([{ fullTextAnnotation: { text } }]);
    await expect(new OcrService().extractText('fixture.png')).resolves.toBe(
      text,
    );
    expect(mockDetection).toHaveBeenCalledTimes(1);
  });
  it('reports no text as an actionable error', async () => {
    mockDetection.mockResolvedValueOnce([{}]);
    await expect(
      new OcrService().extractText('fixture.png'),
    ).rejects.toMatchObject({ status: 400, response: { code: 'OCR_NO_TEXT' } });
  });
  it('sanitizes provider errors', async () => {
    mockDetection.mockRejectedValueOnce(
      new Error('private-credential-fixture'),
    );
    const log = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await expect(
        new OcrService().extractText('fixture.png'),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'OCR_UNAVAILABLE' },
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'private-credential-fixture',
      );
    } finally {
      log.mockRestore();
    }
  });
});
