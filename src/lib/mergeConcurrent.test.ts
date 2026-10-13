import { describe, it, expect } from 'vitest';
import { mergeConcurrent } from './mergeConcurrent';

describe('mergeConcurrent', () => {
  it('iki bilgisayarın farklı alanlardaki değişikliklerini birlikte korur', () => {
    const base = { id: '1', name: 'Ali', branch: 'Matematik', email: '' };
    const local = { ...base, name: 'Ali Veli' };
    const remote = { ...base, email: 'ali@okul.k12.tr' };
    expect(mergeConcurrent(base, local, remote)).toEqual({
      id: '1',
      name: 'Ali Veli',
      branch: 'Matematik',
      email: 'ali@okul.k12.tr',
    });
  });

  it('aynı alanda yerel değişiklik kazanır', () => {
    const base = { id: '1', name: 'Ali' };
    expect(mergeConcurrent(base, { id: '1', name: 'Ayşe' }, { id: '1', name: 'Mehmet' })).toEqual({ id: '1', name: 'Ayşe' });
  });

  it('yerelde silinen alan sonuçta da silinir', () => {
    const base: { id: string; note?: string; x: number } = { id: '1', note: 'a', x: 1 };
    const local: { id: string; note?: string; x: number } = { id: '1', x: 1 };
    const remote = { id: '1', note: 'a', x: 2 };
    expect(mergeConcurrent(base, local, remote)).toEqual({ id: '1', x: 2 });
  });

  it('dizi alanları bütün olarak karşılaştırılır', () => {
    const base = { id: 'l', assignedTeacherIds: ['t1'] };
    const local = { id: 'l', assignedTeacherIds: ['t1', 't2'] };
    const remote = { id: 'l', assignedTeacherIds: ['t1'], name: 'Bahçe' };
    expect(mergeConcurrent(base, local, remote)).toEqual({ id: 'l', assignedTeacherIds: ['t1', 't2'], name: 'Bahçe' });
  });

  it('temel sürüm bilinmiyorsa yerel olduğu gibi kullanılır', () => {
    expect(mergeConcurrent(undefined, { id: '1', a: 1 }, { id: '1', a: 2 })).toEqual({ id: '1', a: 1 });
  });
});
