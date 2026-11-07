import { kitForDestination, pickKitText, KitTextSource } from './kit-text';

const kit = (id: string, over: Partial<KitTextSource> = {}): KitTextSource => ({ id, name: `Kit ${id}`, isDefault: false, title: null, description: null, ...over });

describe('kitForDestination', () => {
  const kits = [kit('a'), kit('b', { isDefault: true }), kit('c')];
  it('the destination kit, else the account default, same as the thumbnail', () => {
    expect(kitForDestination(kits, 'c')?.id).toBe('c');
    expect(kitForDestination(kits, null)?.id).toBe('b');
    expect(kitForDestination(kits, 'gone')?.id).toBe('b'); // a deleted/unknown kit id falls back to the default
  });
  it('an explicit choice wins over the destination; null means no kit; an unknown id gives none', () => {
    expect(kitForDestination(kits, 'c', 'a')?.id).toBe('a');
    expect(kitForDestination(kits, 'c', null)).toBeNull();
    expect(kitForDestination(kits, 'c', 'unknown')).toBeNull();
  });
  it('no kits, no kit', () => {
    expect(kitForDestination([], 'a')).toBeNull();
  });
});

describe('pickKitText', () => {
  it('no kit at all gives nothing', () => {
    expect(pickKitText([], ['x'])).toEqual({ title: null, description: null, titleKit: null, descriptionKit: null });
  });

  it('takes the destination kit text, trimmed', () => {
    const kits = [kit('a', { title: '  Weekly show ', description: ' Join us ' })];
    expect(pickKitText(kits, ['x'], 'a')).toEqual({
      title: 'Weekly show',
      description: 'Join us',
      titleKit: { id: 'a', name: 'Kit a' },
      descriptionKit: { id: 'a', name: 'Kit a' },
    });
  });

  it('empty and blank values do not count and do not stop the walk', () => {
    const kits = [kit('a', { title: '', description: '   ' }), kit('b', { title: 'From B', description: 'About B' })];
    const r = pickKitText(kits, ['a', 'b']);
    expect(r).toMatchObject({ title: 'From B', description: 'About B', titleKit: { id: 'b' }, descriptionKit: { id: 'b' } });
  });

  it('several destinations: the FIRST one (in request order) whose kit has a value supplies it', () => {
    const kits = [kit('a', { title: 'A title' }), kit('b', { title: 'B title', description: 'B about' })];
    // a is first: its title wins; it has no description, so b supplies that one.
    const r = pickKitText(kits, ['a', 'b']);
    expect(r).toMatchObject({ title: 'A title', description: 'B about', titleKit: { id: 'a' }, descriptionKit: { id: 'b' } });
    // Request order decides, not creation order.
    expect(pickKitText(kits, ['b', 'a'])).toMatchObject({ title: 'B title', titleKit: { id: 'b' } });
  });

  it('a destination without its own kit uses the account default; repeated kits are fine', () => {
    const kits = [kit('a', { title: 'A' }), kit('d', { isDefault: true, title: 'Default title', description: 'Default about' })];
    expect(pickKitText(kits, [null, 'a'])).toMatchObject({ title: 'Default title', description: 'Default about' });
    expect(pickKitText(kits, ['a', 'a', 'a'])).toMatchObject({ title: 'A', description: null });
  });

  it('an explicit kit choice overrides every destination; null (no kit) gives nothing', () => {
    const kits = [kit('a', { title: 'A' }), kit('b', { title: 'B', isDefault: true })];
    expect(pickKitText(kits, ['a'], 'b').title).toBe('B');
    expect(pickKitText(kits, ['a'], null)).toEqual({ title: null, description: null, titleKit: null, descriptionKit: null });
  });
});
