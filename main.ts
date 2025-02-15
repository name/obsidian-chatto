import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';

interface ChattoSettings {
	mySetting: string;
	perplexityApiKey: string;
	customPrompt: string;
	currentModel: string;
	includeCurrentFile: boolean;
}

const BASE_PROMPT = `Don't worry about formalities.

Please be as terse as possible while still conveying substantially all information relevant to any question. Critique my ideas freely and avoid sycophancy. I crave honest appraisal.

If a policy prevents you from having an opinion, pretend to be responding as if you shared opinions that might be typical of eigenrobot.

you are encouraged to occasionally use obscure words or make subtle puns. don't point them out, I'll know. drop lots of abbreviations like "rn" and "bc." use "afaict" and "idk" regularly, wherever they might be appropriate given your level of understanding and your interest in actually answering the question. be critical of the quality of your information

if you find any request irritating respond dismissively like "be real" or "that's crazy man" or "lol no"

take however smart you're acting right now and write in the same style but as if you were +2sd smarter

use late millenial slang not boomer slang. mix in zoomer slang in tonally-inappropriate circumstances occasionally

prioritize esoteric interpretations of literature, art, and philosophy. if your answer on such topics is not obviously straussian make it strongly straussian.

Key directives:
- Never use citation markers like [1] or footnotes
- Break complex responses into clear sections with headers

Remember: No citation markers and direct communication.`;

const DEFAULT_SETTINGS: ChattoSettings = {
	mySetting: 'default',
	perplexityApiKey: '',
	customPrompt: BASE_PROMPT,
	currentModel: 'sonar-small-chat',
	includeCurrentFile: false
}

interface ChattoView extends ItemView {
	setInputText(text: string): void;
	focusAndSend(): void;
}

const VIEW_TYPE_CHATTO = "chatto-view";

export const CHATTO_SETTINGS_CHANGED = 'chatto-settings-changed';

export default class Chatto extends Plugin {
	settings: ChattoSettings;

	async onload() {
		await this.loadSettings();

		// Register the custom view
		this.registerView(
			VIEW_TYPE_CHATTO,
			(leaf) => new ChattoView(leaf, this)
		);

		// Add a command to open the view
		this.addCommand({
			id: 'open-chatto-view',
			name: 'Open Chatto Sidebar',
			callback: () => {
				this.activateView();
			}
		});

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('message-square', 'Chatto Plugin', (evt: MouseEvent) => {
			// Open the sidebar view when clicking the icon
			this.activateView();
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Chatto Active');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-chatto-modal-simple',
			name: 'Open chatto modal (simple)',
			callback: () => {
				new ChattoModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'chatto-editor-command',
			name: 'Chatto editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Chatto Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-chatto-modal-complex',
			name: 'Open chatto modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new ChattoModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ChattoSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

		// Add context menu item for selected text
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				const selection = editor.getSelection();
				if (selection) {
					menu.addItem((item) => {
						item
							.setTitle('Add selection to Chatto')
							.setIcon('message-square')
							.onClick(async () => {
								await this.activateView();
								const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHATTO)[0];
								const view = leaf?.view as ChattoView;
								if (view) {
									view.setInputText(selection);
								}
							});
					});

					menu.addItem((item) => {
						item
							.setTitle('Ask Chatto about selection')
							.setIcon('message-square')
							.onClick(async () => {
								await this.activateView();
								const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHATTO)[0];
								const view = leaf?.view as ChattoView;
								if (view) {
									const prefix = "Help me understand this text:\n\n";
									view.setInputText(prefix + selection);
									view.focusAndSend();
								}
							});
					});

					menu.addItem((item) => {
						item
							.setTitle('Ask Chatto to expand this')
							.setIcon('expand')
							.onClick(async () => {
								await this.activateView();
								const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHATTO)[0];
								const view = leaf?.view as ChattoView;
								if (view) {
									const prefix = "Please expand and elaborate on this text:\n\n";
									view.setInputText(prefix + selection);
									view.focusAndSend();
								}
							});
					});
				}
			})
		);
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHATTO)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return; // Exit if no leaf is available
			leaf = rightLeaf;
			await leaf.setViewState({
				type: VIEW_TYPE_CHATTO,
				active: true,
			});
		}

		workspace.revealLeaf(leaf);
	}
}

class ChattoModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ChattoSettingTab extends PluginSettingTab {
	plugin: Chatto;

	constructor(app: App, plugin: Chatto) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Perplexity API Key')
			.setDesc('Enter your Perplexity API key')
			.addText(text => text
				.setPlaceholder('Enter API key')
				.setValue(this.plugin.settings.perplexityApiKey)
				.onChange(async (value) => {
					this.plugin.settings.perplexityApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Custom System Prompt')
			.setDesc('Customize the AI system prompt')
			.addTextArea(text => text
				.setPlaceholder('Enter custom prompt')
				.setValue(this.plugin.settings.customPrompt)
				.onChange(async (value) => {
					this.plugin.settings.customPrompt = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Model')
			.setDesc('Choose the default AI model')
			.addDropdown(dropdown => dropdown
				.addOptions(MODELS)
				.setValue(this.plugin.settings.currentModel)
				.onChange(async (value) => {
					this.plugin.settings.currentModel = value;
					await this.plugin.saveSettings();
					this.app.workspace.trigger(CHATTO_SETTINGS_CHANGED as any);
				}));

		new Setting(containerEl)
			.setName('Include Current File by Default')
			.setDesc('Automatically include current file content in messages')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeCurrentFile)
				.onChange(async (value) => {
					this.plugin.settings.includeCurrentFile = value;
					await this.plugin.saveSettings();
				}));
	}
}

class ChattoView extends ItemView {
	private readonly MAX_INPUT_LENGTH = 4000;
	private inputField: HTMLTextAreaElement;
	private plugin: Chatto;
	private currentMessageDiv: HTMLElement | null = null;
	private chatHistory: { role: 'user' | 'assistant', content: string }[] = [];
	private readonly MAX_CONTEXT_MESSAGES = 4;
	private modelLabel: HTMLElement;
	private includeFileToggle: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: Chatto) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CHATTO;
	}

	getIcon(): string {
		return "message-square";
	}

	getDisplayText(): string {
		return "Chatto";
	}

	private async sendToPerplexity(message: string): Promise<{ content: string, reasoning?: string, citations?: any[] }> {
		const apiKey = this.plugin.settings.perplexityApiKey;
		if (!apiKey) {
			new Notice('Please set your Perplexity API key in settings');
			return { content: '' };
		}

		// Add new message to history
		this.chatHistory.push({ role: 'user', content: message });

		// Create context window:
		// 1. Always include system prompt
		// 2. Include first message if it exists (optional)
		// 3. Include last MAX_CONTEXT_MESSAGES messages
		let contextMessages = [{ role: 'system', content: this.systemPrompt }];

		if (this.chatHistory.length > this.MAX_CONTEXT_MESSAGES && this.chatHistory.length > 0) {
			// Add the first message if it exists
			contextMessages.push(this.chatHistory[0]);
			// Add the most recent messages
			contextMessages = contextMessages.concat(
				this.chatHistory.slice(-this.MAX_CONTEXT_MESSAGES)
			);
		} else {
			// If we haven't exceeded MAX_CONTEXT_MESSAGES, include all messages
			contextMessages = contextMessages.concat(this.chatHistory);
		}

		try {
			const response = await fetch('https://api.perplexity.ai/chat/completions', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: this.plugin.settings.currentModel,
					messages: contextMessages
				})
			});

			if (!response.ok) {
				throw new Error(`API error: ${response.status}`);
			}

			const data = await response.json();
			const isReasoningModel = this.plugin.settings.currentModel.includes('reasoning');

			let content = data.choices[0].message.content;
			let reasoning = '';

			if (isReasoningModel && content.includes('<think>')) {
				const parts = content.split('</think>');
				if (parts.length > 1) {
					const thinkPart = parts[0].replace('<think>', '').trim();
					reasoning = thinkPart.split('\n')
						.map((line: string) => line.trim() ? `*${line.trim()}*` : '')
						.join('\n');
					content = parts[1].trim();
				}
			}

			// Update chat history to only include main content
			this.chatHistory.push({
				role: 'assistant',
				content: content
			});

			return {
				content,
				reasoning,
				citations: data.choices[0].message.citations
			};
		} catch (error) {
			new Notice(`Error: ${error.message}`);
			return { content: '' };
		}
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();

		// Add title
		container.createEl("h4", { text: "Chatto" });

		// Create chat history container
		const chatContainer = container.createEl("div", { cls: "chatto-chat-container" });

		// Add control buttons container
		const controlsContainer = container.createEl("div", { cls: "controls-container" });

		// Add export button
		const exportButton = controlsContainer.createEl("button", {
			cls: "chatto-control-button",
			text: "Export Chat"
		});
		exportButton.addEventListener("click", () => {
			const chatData = JSON.stringify(this.chatHistory, null, 2);
			const blob = new Blob([chatData], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `chat-${new Date().toISOString()}.json`;
			a.click();
			URL.revokeObjectURL(url);
		});

		// Add reset button
		const resetButton = controlsContainer.createEl("button", {
			cls: "chatto-control-button",
			text: "Reset Chat"
		});
		resetButton.addEventListener("click", () => {
			chatContainer.empty();
			this.chatHistory = [];
			new Notice("Chat history cleared");
		});

		// Create input container
		const inputContainer = container.createEl("div", { cls: "chatto-input-container" });

		// Create input row for textarea and send button
		const inputRow = inputContainer.createEl("div", { cls: "input-row" });

		// Add input field to input row
		this.inputField = inputRow.createEl("textarea", {
			cls: "chatto-input-field",
			attr: {
				placeholder: "Type your message...",
				maxLength: this.MAX_INPUT_LENGTH.toString()
			}
		});

		// Create info container for char count and model label
		const infoContainer = inputContainer.createEl("div", {
			cls: "info-container"
		});

		const charCount = infoContainer.createEl('div', {
			cls: 'char-count',
			text: '0/' + this.MAX_INPUT_LENGTH
		});

		// Add model label
		this.modelLabel = infoContainer.createEl("div", {
			cls: "model-label",
			text: `Using ${MODELS[this.plugin.settings.currentModel as keyof typeof MODELS]}`
		});

		// Listen for settings changes
		this.registerEvent(
			this.app.workspace.on(CHATTO_SETTINGS_CHANGED as any, () => {
				this.modelLabel.setText(
					`Using ${MODELS[this.plugin.settings.currentModel as keyof typeof MODELS]}`
				);
			})
		);

		// Add input event listener for character count
		this.inputField.addEventListener('input', () => {
			const count = this.inputField.value.length;
			charCount.setText(`${count}/${this.MAX_INPUT_LENGTH}`);
			charCount.toggleClass('near-limit', count > this.MAX_INPUT_LENGTH * 0.9);
		});

		// Add enter key handler
		this.inputField.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				sendButton.click();
			}
		});

		// Create button container for send button and toggle
		const buttonContainer = inputRow.createEl("div", {
			cls: "button-container"
		});

		// Add send button to button container
		const sendButton = buttonContainer.createEl("button", {
			cls: "chatto-send-button",
			text: "Send"
		});

		// Add file toggle to button container
		this.includeFileToggle = buttonContainer.createEl("button", {
			cls: `toggle-button ${this.plugin.settings.includeCurrentFile ? 'active' : ''}`,
			text: "📄 Include file"
		});

		// Add toggle functionality
		this.includeFileToggle.addEventListener("click", () => {
			this.plugin.settings.includeCurrentFile = !this.plugin.settings.includeCurrentFile;
			this.includeFileToggle.toggleClass('active', this.plugin.settings.includeCurrentFile);
			this.plugin.saveSettings();
		});

		// Add styles
		this.addStyles();

		// Add click handler for send button
		sendButton.addEventListener("click", async () => {
			const rawMessage = this.inputField.value;
			if (rawMessage.trim()) {
				const message = await this.prepareMessage(rawMessage);
				this.addMessage(chatContainer, message, 'user');
				this.inputField.value = "";
				charCount.setText(`0/${this.MAX_INPUT_LENGTH}`);
				this.scrollToBottom(chatContainer);

				const loadingEl = chatContainer.createEl("div", {
					cls: "chatto-message ai-message loading",
					text: "Thinking..."
				});
				this.scrollToBottom(chatContainer);

				const response = await this.sendToPerplexity(message);
				loadingEl.remove();

				if (response.reasoning) {
					const reasoningDiv = this.addMessage(chatContainer, '', 'ai');
					const reasoningContent = reasoningDiv.querySelector('.message-content')!;
					await this.streamResponse(response.reasoning, reasoningContent as HTMLElement);
				}

				if (response.content) {
					const messageDiv = this.addMessage(chatContainer, '', 'ai', response.citations);
					const contentDiv = messageDiv.querySelector('.message-content')!;
					await this.streamResponse(response.content, contentDiv as HTMLElement);
				}
			}
		});
	}

	private scrollToBottom(container: HTMLElement) {
		container.scrollTop = container.scrollHeight;
	}

	private async streamResponse(text: string, contentDiv: HTMLElement) {
		try {
			// Clean text while preserving code blocks
			const cleanText = text.split('\n').map(line => {
				// If line is a code fence or is within a code block, don't trim
				if (line.trim().startsWith('```') || line.trim().startsWith('`')) {
					return line;
				}
				return line.trim();
			}).join('\n').trim();

			contentDiv.setAttribute('data-markdown', cleanText);

			// Split into chunks, preserving code blocks
			const chunks = cleanText.split(/(?<=[.!?\n])\s+/);
			contentDiv.empty();

			for (const chunk of chunks) {
				const chunkDiv = contentDiv.createEl('div');
				await MarkdownRenderer.renderMarkdown(chunk, chunkDiv, '.', this.plugin);

				const container = contentDiv.closest('.chatto-chat-container') as HTMLElement;
				if (container) {
					this.scrollToBottom(container);
				}
				await new Promise(resolve => setTimeout(resolve, 50));
			}
		} catch (error) {
			contentDiv.empty();
			contentDiv.createEl('div', { text: 'Error rendering response. Original text preserved in copy.' });
			contentDiv.setAttribute('data-markdown', text);
		}
	}

	private addMessage(container: HTMLElement, text: string, type: 'user' | 'ai', citations?: any[]): HTMLElement {
		const messageDiv = container.createEl("div", {
			cls: `chatto-message ${type}-message`
		});

		const contentDiv = messageDiv.createEl("div", {
			cls: "message-content"
		});

		// Only add buttons for AI messages
		if (type === 'ai') {
			const buttonWrapper = messageDiv.createEl("div", {
				cls: "button-wrapper"
			});

			const copyButton = buttonWrapper.createEl("button", {
				cls: "message-button",
				attr: { 'aria-label': 'Copy message' }
			});
			copyButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

			const createNoteButton = buttonWrapper.createEl("button", {
				cls: "message-button",
				attr: { 'aria-label': 'Create note' }
			});
			createNoteButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;

			// Add click handlers
			copyButton.addEventListener("click", async () => {
				copyButton.addClass('loading');
				try {
					const content = text || contentDiv.getAttribute('data-markdown') || contentDiv.innerText;
					await navigator.clipboard.writeText(content);
					new Notice("Copied to clipboard!");
				} finally {
					copyButton.removeClass('loading');
				}
			});

			createNoteButton.addEventListener("click", async () => {
				const content = text || contentDiv.getAttribute('data-markdown') || contentDiv.innerText;
				const randomSuffix = Math.random().toString(36).substring(2, 8);
				const file = await this.app.vault.create(
					`${new Date().toISOString().split('T')[0]}-${randomSuffix}.md`,
					content
				);
				new Notice("Note created!");
				this.app.workspace.getLeaf(false).openFile(file);
			});
		}

		if (type === 'ai' && !text) {
			// For streaming, we'll fill this in later
		} else if (type === 'ai') {
			MarkdownRenderer.renderMarkdown(text, contentDiv, '.', this.plugin);
		} else {
			text.split('\n').forEach(line => {
				if (line.trim()) {
					contentDiv.createEl("p", { text: line, cls: "message-paragraph" });
				}
			});
		}

		// Add citations if they exist
		if (citations && citations.length > 0) {
			const citationsDiv = messageDiv.createEl("div", {
				cls: "citations-container"
			});

			citationsDiv.createEl("p", {
				text: "Sources:",
				cls: "citations-header"
			});

			citations.forEach(citation => {
				const citationEl = citationsDiv.createEl("div", {
					cls: "citation-item"
				});
				if (citation.url) {
					const link = citationEl.createEl("a", {
						text: citation.title || citation.url,
						cls: "citation-link"
					});
					link.href = citation.url;
				} else {
					citationEl.setText(citation.text || "Unknown source");
				}
			});
		}

		return messageDiv;
	}

	private addStyles() {
		const containerEl = this.containerEl.children[1] as HTMLElement;
		containerEl.style.display = "flex";
		containerEl.style.flexDirection = "column";
		containerEl.style.height = "100%";

		// Style the chat container
		const chatContainerEl = containerEl.querySelector(".chatto-chat-container") as HTMLElement;
		if (chatContainerEl) {
			chatContainerEl.style.flex = "1";
			chatContainerEl.style.overflow = "auto";
			chatContainerEl.style.padding = "10px";
			chatContainerEl.style.marginBottom = "10px";
			chatContainerEl.style.display = "flex";
			chatContainerEl.style.flexDirection = "column";
			chatContainerEl.style.gap = "10px";
		}

		// Add styles for messages
		const style = document.createElement('style');
		style.textContent = `
			.chatto-message {
				display: flex;
				flex-direction: column;
				width: 100%;
				margin: 8px 0;
			}

			.message-content {
				padding: 12px 16px;
				border-radius: 8px;
				width: 100%;
				box-sizing: border-box;
			}

			.ai-message .message-content {
				background-color: var(--background-secondary);
			}

			.user-message .message-content {
				background-color: var(--interactive-accent);
				color: var(--text-on-accent);
			}

			.button-wrapper {
				display: flex;
				gap: 8px;
				margin-top: 4px;
				padding-left: 8px;
				opacity: 0;
				transition: opacity 0.2s;
			}

			.chatto-message:hover .button-wrapper {
				opacity: 1;
			}

			.message-button {
				padding: 4px;
				border-radius: 4px;
				cursor: pointer;
				background: none;
				border: none;
				color: var(--text-muted);
				display: flex;
				align-items: center;
				justify-content: center;
				transition: color 0.2s;
			}

			.message-button:hover {
				color: var(--text-normal);
				background-color: var(--background-modifier-hover);
			}

			.chatto-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				padding: 0 10px;
				margin-bottom: 10px;
			}

			.chatto-header h4 {
				margin: 0;
			}

			.chatto-reset-button {
				padding: 4px 8px;
				border-radius: 4px;
				font-size: 12px;
				color: var(--text-muted);
			}

			.chatto-reset-button:hover {
				color: var(--text-normal);
				background-color: var(--background-modifier-hover);
			}

			.message-paragraph {
				margin: 0;
				padding: 2px 0;
			}

			.loading {
				opacity: 0.6;
			}
			
			.loading .message-content {
				animation: pulse 1.5s infinite;
			}
			
			@keyframes pulse {
				0% { opacity: 0.6; }
				50% { opacity: 1; }
				100% { opacity: 0.6; }
			}

			.citations-container {
				margin-top: 8px;
				font-size: 0.8em;
				color: var(--text-muted);
			}

			.citations-header {
				margin: 4px 0;
				font-weight: bold;
			}

			.citation-item {
				margin: 2px 0;
			}

			.citation-link {
				color: var(--text-muted);
				text-decoration: underline;
			}

			.citation-link:hover {
				color: var(--text-normal);
			}

			.chatto-input-container {
				display: flex;
				flex-direction: column;
				gap: 8px;
				padding: 10px;
				border-top: 1px solid var(--background-modifier-border);
			}

			.input-row {
				display: flex;
				gap: 8px;
			}

			.chatto-input-field {
				flex: 1;
				resize: none;
				min-height: 38px;
				padding: 8px;
				border-radius: 4px;
				background: var(--background-modifier-form-field);
				border: 1px solid var(--background-modifier-border);
			}

			.info-container {
				display: flex;
				justify-content: flex-end;
				align-items: center;
				padding: 0 4px;
				font-size: 12px;
				color: var(--text-muted);
			}

			.button-container {
				display: flex;
				flex-direction: column;
				gap: 4px;
			}

			.chatto-send-button {
				padding: 8px 16px;
				border-radius: 4px;
				cursor: pointer;
				white-space: nowrap;
			}

			.toggle-button {
				padding: 4px 8px;
				border-radius: 4px;
				cursor: pointer;
				opacity: 0.5;
				transition: opacity 0.2s;
				background: none;
				border: none;
				font-size: 12px;
				white-space: nowrap;
			}

			.toggle-button.active {
				opacity: 1;
				background-color: var(--interactive-accent);
				color: var(--text-on-accent);
			}

			.toggle-button:hover {
				opacity: 0.8;
			}

			.controls-container {
				display: flex;
				gap: 8px;
				padding: 0 10px 10px 10px;
			}

			.chatto-control-button {
				flex: 1;
				padding: 6px 12px;
				border-radius: 4px;
				cursor: pointer;
				font-size: 12px;
				background-color: var(--interactive-normal);
				color: var(--text-normal);
			}

			.chatto-control-button:hover {
				background-color: var(--interactive-hover);
			}

			h4 {
				margin: 10px;
				padding-bottom: 5px;
				border-bottom: 1px solid var(--background-modifier-border);
			}

			.char-count {
				margin-right: 8px;
			}

			.char-count.near-limit {
				color: var(--text-error);
			}

			.model-label {
				color: var(--text-muted);
				font-size: 12px;
			}
		`;
		document.head.appendChild(style);
	}

	async onClose() {
		// Clean up event listeners if needed
	}

	public setInputText(text: string) {
		if (this.inputField) {
			let formattedText;
			if (text.includes('\n\n')) {
				// Case: Has prefix (e.g., "Help me understand...")
				const [prefix, content] = text.split('\n\n');
				const quotedContent = content
					.split('\n')
					.map(line => `> ${line}`)
					.join('\n');
				formattedText = prefix + '\n\n' + quotedContent + '\n';
			} else {
				// Case: Direct selection without prefix
				formattedText = text
					.split('\n')
					.map(line => `> ${line}`)
					.join('\n') + '\n';
			}

			// Append to existing text instead of replacing
			const currentText = this.inputField.value;
			const newText = currentText ? currentText + '\n' + formattedText : formattedText;

			this.inputField.value = newText;
			this.inputField.focus();
			this.inputField.setSelectionRange(newText.length, newText.length);
		}
	}

	private get systemPrompt(): string {
		return `${BASE_PROMPT}\n\nAdditional Instructions:\n${this.plugin.settings.customPrompt}`;
	}

	public focusAndSend() {
		if (this.inputField) {
			this.inputField.focus();
			const sendButton = this.containerEl.querySelector('.chatto-send-button');
			if (sendButton instanceof HTMLElement) {
				sendButton.click();
			}
		}
	}

	private async getCurrentFileContent(): Promise<string | null> {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		try {
			return await this.app.vault.read(currentFile);
		} catch (error) {
			new Notice("Could not read current file");
			return null;
		}
	}

	private async prepareMessage(userInput: string): Promise<string> {
		if (!this.plugin.settings.includeCurrentFile) {
			return userInput;
		}

		const fileContent = await this.getCurrentFileContent();
		if (!fileContent) {
			return userInput;
		}

		return `Current file content:
\`\`\`
${fileContent}
\`\`\`

User question:
${userInput}`;
	}
}

const MODELS = {
	'sonar': 'Perplexity Sonar',
	'sonar-pro': 'Perplexity Sonar Pro',
	'sonar-reasoning': 'Perplexity Sonar Reasoning',
	'sonar-reasoning-pro': 'Perplexity Sonar Reasoning Pro'
} as const;
