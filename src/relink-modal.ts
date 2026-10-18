import { type App, Modal, Setting } from 'obsidian';

/**
 * Asks whether to link a note that has no `atproto_uri` to the document that
 * already exists at its path (it probably lost the link). Resolves `true` for
 * "Link and update", `false` for "Cancel" **or closing the dialog** (Escape,
 * clicking outside), and never resolves twice.
 */
export function confirmRelink(app: App, path: string, uri: string): Promise<boolean> {
	return new Promise((resolve) => new RelinkModal(app, path, uri, resolve).open());
}

class RelinkModal extends Modal {
	/** Set once a button decides the answer, so closing afterwards doesn't answer again. */
	private answered = false;

	constructor(
		app: App,
		private readonly path: string,
		private readonly uri: string,
		private readonly resolve: (link: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle('Link to the existing document?');

		const { contentEl } = this;
		contentEl.createEl('p', {
			text: `A document is already published at ${this.path}, but this note has no "atproto_uri" linking to it. It may have lost the link, for example after being copied or recreated.`,
		});
		contentEl.createEl('p', { text: 'Link this note to that document and update it with this note’s content?' });
		contentEl.createEl('p', { text: this.uri, cls: 'setting-item-description' });

		new Setting(contentEl)
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
