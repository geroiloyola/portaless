import type { PageLayout } from "../types";

const MAX_HISTORY_SIZE = 100;

export class EditorHistory {
  private past: PageLayout[] = [];
  private future: PageLayout[] = [];
  private current: PageLayout;

  constructor(initial: PageLayout) {
    this.current = EditorHistory.clone(initial);
  }

  static clone(layout: PageLayout): PageLayout {
    return JSON.parse(JSON.stringify(layout));
  }

  getCurrent(): PageLayout {
    return this.current;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  push(next: PageLayout): void {
    this.past.push(this.current);
    if (this.past.length > MAX_HISTORY_SIZE) this.past.shift();
    this.current = EditorHistory.clone(next);
    this.future = [];
  }

  undo(): PageLayout | null {
    if (!this.canUndo) return null;
    const previous = this.past.pop() as PageLayout;
    this.future.unshift(this.current);
    this.current = previous;
    return EditorHistory.clone(this.current);
  }

  redo(): PageLayout | null {
    if (!this.canRedo) return null;
    const next = this.future.shift() as PageLayout;
    this.past.push(this.current);
    this.current = next;
    return EditorHistory.clone(this.current);
  }
}
