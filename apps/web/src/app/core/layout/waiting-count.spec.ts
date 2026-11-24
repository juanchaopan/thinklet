import { countText, waitingInAll, waitingText } from './waiting-count';

describe('countText', () => {
  it('writes the number up to 99, and 99+ past it', () => {
    expect(countText(1)).toBe('1');
    expect(countText(99)).toBe('99');
    expect(countText(100)).toBe('99+');
  });
});

describe('waitingText', () => {
  it('says how many requests wait, as the badge counts them', () => {
    expect(waitingText(2)).toBe('，2 个申请等你处理');
    expect(waitingText(120)).toBe('，99+ 个申请等你处理');
  });
});

describe('waitingInAll', () => {
  it('adds up the counts the families carry, which only the families the parent runs do', () => {
    expect(waitingInAll([{ pendingRequests: 1 }, {}, { pendingRequests: 2 }])).toBe(3);
    expect(waitingInAll([{}, { pendingRequests: 0 }])).toBe(0);
    expect(waitingInAll([])).toBe(0);
  });
});
