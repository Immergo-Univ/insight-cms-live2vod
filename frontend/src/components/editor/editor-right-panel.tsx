/**
 * Right sidebar: Metadata only (Capture + Preview live next to the player).
 */
export function EditorRightPanel() {
  return (
    <div className="flex w-80 shrink-0 flex-col gap-4 bg-primary">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary">
          Metadata
        </h3>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-secondary">
            Title <span className="text-error-primary">*</span>
          </label>
          <input
            type="text"
            placeholder="Clip title"
            className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary placeholder:text-placeholder"
          />
          <label className="text-xs font-medium text-secondary">
            Description <span className="text-error-primary">*</span>
          </label>
          <textarea
            placeholder="Clip description"
            rows={3}
            className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary placeholder:text-placeholder"
          />
          <p className="text-[10px] text-tertiary">Max 255 characters</p>
          <label className="text-xs font-medium text-secondary">Tags</label>
          <input
            type="text"
            placeholder="Tags"
            className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary placeholder:text-placeholder"
          />
          <p className="text-[10px] text-tertiary">Max 200 characters</p>
        </div>
      </section>
    </div>
  );
}
