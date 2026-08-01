export type DraftEditState = {
  status: "idle" | "saved" | "error" | "conflict";
  message: string | null;
  title: string;
  goal: string;
};

export const initialDraftEditState: DraftEditState = {
  status: "idle",
  message: null,
  title: "",
  goal: "",
};

export type ReflectionState = {
  status: "idle" | "saved" | "error" | "conflict";
  message: string | null;
  learned: string;
  confusing: string;
  feeling: string;
};

export const initialReflectionState: ReflectionState = {
  status: "idle",
  message: null,
  learned: "",
  confusing: "",
  feeling: "",
};
