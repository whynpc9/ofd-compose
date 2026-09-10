export const bindingPolicyVersions = ["strict-1", "legacy-compat-1"] as const;

export type BindingPolicyVersion = (typeof bindingPolicyVersions)[number];
