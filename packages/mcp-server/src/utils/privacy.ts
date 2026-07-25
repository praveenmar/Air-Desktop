export interface PrivacyMeta {
  privacy: string;
}

export function createPrivacyMeta(): PrivacyMeta {
  return {
    privacy: "This context may contain local DOM excerpts or masked values. Do not leak sensitive PII."
  };
}

export function wrapWithPrivacy<T>(data: T): { _meta: PrivacyMeta; data: T } {
  return {
    _meta: createPrivacyMeta(),
    data
  };
}
