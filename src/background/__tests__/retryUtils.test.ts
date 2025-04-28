import { withRetry, capturePageHTML, captureScreenshot, troubleshootWithLLM } from '../retryUtils';

// Mock chrome APIs
global.chrome = {
  scripting: {
    executeScript: jest.fn().mockResolvedValue([{ result: '<html>mocked</html>' }]),
  },
  tabs: {
    get: jest.fn().mockResolvedValue({ windowId: 1 }),
    captureVisibleTab: jest.fn((windowId, opts, cb) => {
      if (typeof cb === 'function') cb('data:image/png;base64,mockscreenshot');
      // For promise-based usage
      return Promise.resolve('data:image/png;base64,mockscreenshot');
    }),
  },
} as any;

describe('withRetry', () => {
  it('resolves on first try if no error', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 3, 10, jest.fn());
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on error and calls onFail after all attempts', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok');
    const onFail = jest.fn();
    const result = await withRetry(fn, 2, 1, onFail);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('calls onFail after all retries fail', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const onFail = jest.fn();
    await expect(withRetry(fn, 2, 1, onFail)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onFail).toHaveBeenCalled();
  });
});

describe('capturePageHTML', () => {
  it('returns HTML string from executeScript', async () => {
    const html = await capturePageHTML(123);
    expect(html).toBe('<html>mocked</html>');
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });
});

describe('captureScreenshot', () => {
  it('returns screenshot data URL', async () => {
    const dataUrl = await captureScreenshot(123);
    expect(dataUrl).toMatch(/^data:image\/png;base64/);
    expect(chrome.tabs.get).toHaveBeenCalled();
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalled();
  });
});

describe('troubleshootWithLLM', () => {
  it('assembles prompt and calls capture functions', async () => {
    const step = { action: 'click', selector: '#foo' } as any;
    const error = new Error('fail');
    const logSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    await troubleshootWithLLM(step, error, 123);
    expect(logSpy).toHaveBeenCalledWith(
      'LLM troubleshooting prompt:',
      expect.stringContaining('I attempted the step:')
    );
    logSpy.mockRestore();
  });
}); 