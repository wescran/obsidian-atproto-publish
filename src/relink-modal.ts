import { type App, Modal, Setting } from 'obsidian';

/**
 * Asks whether to link a note that has no `atproto_uri` to the document,
 * named by its `title`, that already uses its slug and that no other note
 * links to (the note probably lost the link). Resolves `true` for
 * "Link and update", `false` for "Cancel" **or closing the dialog** (Escape,
 * clicking outside), and never resolves twice.
 */
export function confirmRelink(app: App, title: string): Promise<boolean> {
	return new Promise((resolve) => new RelinkModal(app, title, resolve).open());
}

class RelinkModal extends Modal {
	/** Set once a button decides the answer, so closing afterwards doesn't answer again. */
	private answered = false;

	constructor(
		app: App,
		private readonly title: string,
		private readonly resolve: (link: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(`Link to "${this.title}"?`);

		this.contentEl.createEl('p', {
			text: `"${this.title}" is already published with this note's slug, but no note in your vault is linked to it. If this note is its source (for example, it was copied or recreated), link them and update the published document with this note's content.`,
		});

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.answer(false)))
			.addButton((button) =>
				button
					.setButtonText('Link and update')
					.setCta()
					.onClick(() => this.answer(true)),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		// Escape, the close button, or a click outside: treat as "no".
		this.answer(false);
	}

	private answer(link: boolean): void {
		if (this.answered) return;
		this.answered = true;
		this.resolve(link);
		this.close();
	}
}
