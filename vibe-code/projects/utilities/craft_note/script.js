class StickyNotesApp {
    constructor() {
        this.notes = [];
        this.boards = {};
        this.currentBoard = 'default';
        this.draggedNote = null;
        this.dragOffset = { x: 0, y: 0 };
        this.colorPickerTarget = null;
        this.noteIdCounter = 0;
        this.defaultColor = '#fff740';
        this.currentTheme = 'default';
        this.gridSize = 20;
        this.snapMode = false;
        this.gridVisible = true;
        this.selectedNotes = new Set();
        this.isSelecting = false;
        this.selectionStart = { x: 0, y: 0 };
        this.undoStack = [];
        this.maxUndoSteps = 50;
        this.isDraggingMultiple = false;
        this.multiDragOffsets = new Map();
        this.currentEditingNote = null;
        this._boundModalInput = null;
        this.searchQuery = '';

        this.initializeApp();
        this.bindEvents();
        this.loadData();
    }

    initializeApp() {
        this.workspace = document.getElementById('workspace');
        this.boardSelect = document.getElementById('boardSelect');
        this.colorPickerModal = document.getElementById('colorPickerModal');
        this.dropZone = document.getElementById('dropZone');
        this.imageModal = document.getElementById('imageModal');
        this.themeSelect = document.getElementById('themeSelect');
        this.gridOverlay = document.getElementById('gridOverlay');
        this.selectionBox = document.getElementById('selectionBox');
        this.snapBtn = document.getElementById('snapBtn');
        this.gridToggleBtn = document.getElementById('gridToggleBtn');
        this.colorPickerBtn = document.getElementById('colorPickerBtn');
        this.colorDropdown = document.getElementById('colorDropdown');
        this.colorPreview = document.getElementById('colorPreview');
        this.undoBtn = document.getElementById('undoBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.noteModal = document.getElementById('noteModal');
        this.shortcutsModal = document.getElementById('shortcutsModal');
        this.searchInput = document.getElementById('searchInput');
        this.clearSearchBtn = document.getElementById('clearSearchBtn');
    }

    bindEvents() {
        // Buttons
        document.getElementById('newNoteBtn').addEventListener('click', () => this.createNote());
        document.getElementById('dropZoneNewNoteBtn').addEventListener('click', () => this.createNote());
        document.getElementById('newBoardBtn').addEventListener('click', () => this.createBoard());
        document.getElementById('deleteBoardBtn').addEventListener('click', () => this.deleteBoard());
        document.getElementById('autoAlignBtn').addEventListener('click', () => this.autoAlign());
        document.getElementById('snapBtn').addEventListener('click', () => this.toggleSnapMode());
        document.getElementById('gridToggleBtn').addEventListener('click', () => this.toggleGrid());
        document.getElementById('autoGroupBtn').addEventListener('click', () => this.groupByColor());
        document.getElementById('clearAllBtn').addEventListener('click', () => this.clearAll());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadNotes());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportJSON());
        document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
        document.getElementById('importFileInput').addEventListener('change', (e) => this.importJSON(e));
        document.getElementById('shortcutsBtn').addEventListener('click', () => this.toggleShortcutsModal());
        document.getElementById('closeShortcutsModal').addEventListener('click', () => this.hideShortcutsModal());
        this.undoBtn.addEventListener('click', () => this.undo());

        // Board & theme
        this.boardSelect.addEventListener('change', (e) => this.switchBoard(e.target.value));
        this.themeSelect.addEventListener('change', (e) => this.changeTheme(e.target.value));

        // Color picker dropdown
        this.colorPickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleColorDropdown();
        });

        document.addEventListener('click', (e) => {
            if (!this.colorPickerBtn.contains(e.target) && !this.colorDropdown.contains(e.target)) {
                this.hideColorDropdown();
            }
        });

        document.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                this.setDefaultColor(e.target.dataset.color);
                this.hideColorDropdown();
            });
        });

        // Color picker modal (per-note)
        this.colorPickerModal.addEventListener('click', (e) => {
            if (e.target === this.colorPickerModal) this.hideColorPicker();
        });

        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', (e) => this.selectColor(e.target.dataset.color));
        });

        // Image modal
        this.imageModal.addEventListener('click', (e) => {
            if (e.target === this.imageModal) this.hideImageModal();
        });

        // Note modal
        this.noteModal.addEventListener('click', (e) => {
            if (e.target === this.noteModal) this.hideNoteModal();
        });
        document.getElementById('closeNoteModal').addEventListener('click', () => this.hideNoteModal());

        // Shortcuts modal
        this.shortcutsModal.addEventListener('click', (e) => {
            if (e.target === this.shortcutsModal) this.hideShortcutsModal();
        });

        // Search
        this.searchInput.addEventListener('input', () => this.handleSearch());
        this.clearSearchBtn.addEventListener('click', () => {
            this.searchInput.value = '';
            this.handleSearch();
            this.searchInput.focus();
        });

        // Workspace selection
        this.workspace.addEventListener('mousedown', (e) => this.handleWorkspaceMouseDown(e));
        this.workspace.addEventListener('mousemove', (e) => this.handleWorkspaceMouseMove(e));
        this.workspace.addEventListener('mouseup', (e) => this.handleWorkspaceMouseUp(e));

        // Image drag & drop
        this.workspace.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('active');
        });

        this.workspace.addEventListener('dragleave', (e) => {
            if (!this.workspace.contains(e.relatedTarget)) {
                this.dropZone.classList.remove('active');
            }
        });

        this.workspace.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('active');
            this.handleImageDrop(e);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Don't intercept when typing in a textarea/input (except specific combos)
            const isTyping = ['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName);

            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                this.createNote();
            } else if (e.ctrlKey && e.key === 'z' && !isTyping) {
                e.preventDefault();
                this.undo();
            } else if (e.ctrlKey && e.key === 'a' && !isTyping) {
                e.preventDefault();
                this.selectAllNotes();
            } else if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                this.searchInput.focus();
            } else if (e.key === 'Delete' && this.selectedNotes.size > 0 && !isTyping) {
                this.deleteSelectedNotes();
            } else if (e.key === 'Escape') {
                this.handleEscape();
            } else if (e.key === '?' && !isTyping) {
                this.toggleShortcutsModal();
            }
        });
    }

    // ---- Note CRUD ----

    createNote(x = null, y = null, content = '', imageUrl = null, color = null) {
        this.saveStateForUndo();

        const noteId = `note_${this.noteIdCounter++}`;
        const noteColor = color || this.defaultColor;

        let noteX, noteY;
        if (x !== null && y !== null) {
            noteX = x;
            noteY = y;
        } else {
            const pos = this.findValidPosition();
            noteX = pos.x;
            noteY = pos.y;
        }

        const note = {
            id: noteId,
            x: noteX,
            y: noteY,
            content: content,
            imageUrl: imageUrl,
            color: noteColor,
            done: false,
            pinned: false,
            width: 250,
            height: 180,
            timestamp: Date.now()
        };

        this.notes.push(note);
        this.renderNote(note);
        this.saveData();
        this.updateCounts();
        return note;
    }

    duplicateNote(sourceNote) {
        const offset = 20;
        this.createNote(
            sourceNote.x + offset,
            sourceNote.y + offset,
            sourceNote.content,
            sourceNote.imageUrl,
            sourceNote.color
        );
    }

    deleteNote(noteId) {
        const el = document.getElementById(noteId);
        if (el) el.remove();
        this.notes = this.notes.filter(n => n.id !== noteId);
        this.saveData();
        this.updateCounts();
        this.checkDropZoneVisibility();
    }

    toggleDone(noteId) {
        const note = this.notes.find(n => n.id === noteId);
        const el = document.getElementById(noteId);
        if (!note || !el) return;

        note.done = !note.done;
        el.classList.toggle('done', note.done);
        el.querySelector('.btn-done i').className = `fas ${note.done ? 'fa-check' : 'fa-circle'}`;
        this.saveData();
    }

    togglePin(noteId) {
        const note = this.notes.find(n => n.id === noteId);
        const el = document.getElementById(noteId);
        if (!note || !el) return;

        note.pinned = !note.pinned;
        el.classList.toggle('pinned', note.pinned);
        this.saveData();
    }

    // ---- Positioning ----

    findValidPosition() {
        const noteWidth = 250;
        const noteHeight = 180;
        const margin = 20;
        const ww = this.workspace.clientWidth;
        const wh = this.workspace.clientHeight;

        for (let row = 0; row < Math.floor(wh / (noteHeight + margin)); row++) {
            for (let col = 0; col < Math.floor(ww / (noteWidth + margin)); col++) {
                const x = margin + col * (noteWidth + margin);
                const y = margin + row * (noteHeight + margin);
                const occupied = this.notes.some(n =>
                    Math.abs(n.x - x) < noteWidth && Math.abs(n.y - y) < noteHeight
                );
                if (!occupied) return { x, y };
            }
        }

        return {
            x: Math.random() * Math.max(0, ww - noteWidth),
            y: Math.random() * Math.max(0, wh - noteHeight)
        };
    }

    // ---- Rendering ----

    renderNote(note, skipAnimation = false) {
        const el = document.createElement('div');
        el.className = skipAnimation ? 'sticky-note' : 'sticky-note new';
        el.id = note.id;
        el.style.left = `${note.x}px`;
        el.style.top = `${note.y}px`;
        el.style.backgroundColor = note.color;

        if (note.width && note.width !== 250) el.style.width = `${note.width}px`;
        if (note.height && note.height !== 180) {
            el.style.minHeight = `${note.height}px`;
            el.style.maxHeight = `${note.height}px`;
        }

        if (note.color === '#2d3436') el.classList.add('dark-note');
        if (note.done) el.classList.add('done');
        if (note.pinned) el.classList.add('pinned');

        const timeStr = this.formatTimestamp(note.timestamp);

        el.innerHTML = `
            <div class="note-header">
                <div class="note-controls-left">
                    <button class="note-btn btn-done" data-action="toggle-done" title="Toggle done">
                        <i class="fas ${note.done ? 'fa-check' : 'fa-circle'}"></i>
                    </button>
                    <button class="note-btn btn-delete" data-action="delete" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="note-controls-right">
                    <button class="note-btn-action" data-action="pin" title="Pin to top">
                        <i class="fas fa-thumbtack"></i>
                    </button>
                    <button class="note-btn-action" data-action="duplicate" title="Duplicate">
                        <i class="fas fa-clone"></i>
                    </button>
                    <button class="note-btn-action" data-action="fullscreen" title="Expand">
                        <i class="fas fa-expand"></i>
                    </button>
                    <button class="note-btn btn-color" data-action="change-color" title="Change color">
                        <i class="fas fa-palette"></i>
                    </button>
                </div>
            </div>
            <div class="note-content">
                ${note.imageUrl ? `<img src="${note.imageUrl}" class="note-image" alt="Note image" data-note-id="${note.id}">` : ''}
                <textarea class="note-textarea" placeholder="Type your note here...">${this.escapeHtml(note.content)}</textarea>
            </div>
            <div class="note-timestamp">${timeStr}</div>
            <div class="note-resize-handle" data-action="resize"></div>
        `;

        this.workspace.appendChild(el);

        if (!skipAnimation) {
            setTimeout(() => el.classList.remove('new'), 300);
        }

        this.bindNoteEvents(el, note);
        this.hideDropZone();

        // Apply search filter if active
        if (this.searchQuery) this.applySearchFilter();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatTimestamp(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const now = new Date();
        const diffMs = now - d;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return d.toLocaleDateString();
    }

    // ---- Note Events ----

    bindNoteEvents(el, note) {
        const textarea = el.querySelector('.note-textarea');
        const image = el.querySelector('.note-image');

        if (image) {
            image.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showImageModal(note.imageUrl, note.content);
            });
        }

        // Content change
        let lastContent = note.content;
        let hasContentChanged = false;
        let typingTimer;

        textarea.addEventListener('input', (e) => {
            note.content = e.target.value;
            hasContentChanged = true;
            this.saveData();

            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                if (hasContentChanged && note.content !== lastContent) {
                    this.saveStateForUndo();
                    this.updateUndoButton();
                    lastContent = note.content;
                    hasContentChanged = false;
                }
            }, 500);
        });

        textarea.addEventListener('blur', () => {
            clearTimeout(typingTimer);
            if (hasContentChanged && note.content !== lastContent) {
                this.saveStateForUndo();
                this.updateUndoButton();
                lastContent = note.content;
                hasContentChanged = false;
            }
        });

        // Note action buttons
        el.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (!action) return;
            e.stopPropagation();

            switch (action) {
                case 'toggle-done':
                    this.saveStateForUndo();
                    this.toggleDone(note.id);
                    this.updateUndoButton();
                    break;
                case 'change-color':
                    this.showColorPicker(note.id);
                    break;
                case 'delete':
                    this.saveStateForUndo();
                    this.deleteNote(note.id);
                    this.updateUndoButton();
                    break;
                case 'fullscreen':
                    this.showNoteModal(note);
                    break;
                case 'duplicate':
                    this.duplicateNote(note);
                    break;
                case 'pin':
                    this.togglePin(note.id);
                    break;
            }
        });

        // Dragging
        el.addEventListener('mousedown', (e) => {
            if (e.target.closest('[data-action]') ||
                e.target.classList.contains('note-textarea') ||
                e.target.classList.contains('note-image') ||
                e.target.classList.contains('note-resize-handle')) {
                return;
            }
            this.saveStateForUndo();
            this.startDragging(el, note, e);
        });

        // Resize handle
        const resizeHandle = el.querySelector('.note-resize-handle');
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startResize(el, note, e);
        });
    }

    // ---- Dragging ----

    startDragging(el, note, e) {
        if (e.target.closest('[data-action]') ||
            e.target.classList.contains('note-textarea') ||
            e.target.classList.contains('note-image')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (this.selectedNotes.has(note.id) && this.selectedNotes.size > 1) {
            this.startMultiDrag(e);
        } else {
            this.clearSelection();
            this.startSingleDrag(el, note, e);
        }
    }

    startSingleDrag(el, note, e) {
        this.draggedNote = { element: el, note };
        this.dragOffset.x = e.clientX - note.x;
        this.dragOffset.y = e.clientY - note.y;

        el.classList.add('dragging');
        el.style.zIndex = '1000';
        if (this.snapMode) this.gridOverlay.classList.add('snap-active');

        const onMove = (e) => {
            if (!this.draggedNote) return;
            e.preventDefault();

            let newX = e.clientX - this.dragOffset.x;
            let newY = e.clientY - this.dragOffset.y;

            if (this.snapMode) {
                newX = Math.round(newX / this.gridSize) * this.gridSize;
                newY = Math.round(newY / this.gridSize) * this.gridSize;
            }

            const maxX = this.workspace.clientWidth - el.clientWidth;
            const maxY = this.workspace.clientHeight - el.clientHeight;
            note.x = Math.max(0, Math.min(newX, maxX));
            note.y = Math.max(0, Math.min(newY, maxY));
            el.style.left = `${note.x}px`;
            el.style.top = `${note.y}px`;
        };

        const onUp = () => {
            if (this.draggedNote) {
                this.draggedNote.element.classList.remove('dragging');
                this.draggedNote.element.style.zIndex = note.pinned ? '500' : '';
                this.draggedNote = null;
                this.saveData();
            }
            this.gridOverlay.classList.remove('snap-active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    startMultiDrag(e) {
        this.isDraggingMultiple = true;
        this.multiDragOffsets.clear();

        this.selectedNotes.forEach(noteId => {
            const note = this.notes.find(n => n.id === noteId);
            const el = document.getElementById(noteId);
            if (note && el) {
                this.multiDragOffsets.set(noteId, {
                    x: e.clientX - note.x,
                    y: e.clientY - note.y
                });
                el.classList.add('dragging');
                el.style.zIndex = '1000';
            }
        });

        if (this.snapMode) this.gridOverlay.classList.add('snap-active');

        const onMove = (e) => {
            if (!this.isDraggingMultiple) return;
            e.preventDefault();

            this.selectedNotes.forEach(noteId => {
                const note = this.notes.find(n => n.id === noteId);
                const el = document.getElementById(noteId);
                const offset = this.multiDragOffsets.get(noteId);
                if (!note || !el || !offset) return;

                let newX = e.clientX - offset.x;
                let newY = e.clientY - offset.y;

                if (this.snapMode) {
                    newX = Math.round(newX / this.gridSize) * this.gridSize;
                    newY = Math.round(newY / this.gridSize) * this.gridSize;
                }

                const maxX = this.workspace.clientWidth - el.clientWidth;
                const maxY = this.workspace.clientHeight - el.clientHeight;
                note.x = Math.max(0, Math.min(newX, maxX));
                note.y = Math.max(0, Math.min(newY, maxY));
                el.style.left = `${note.x}px`;
                el.style.top = `${note.y}px`;
            });
        };

        const onUp = () => {
            if (this.isDraggingMultiple) {
                this.selectedNotes.forEach(noteId => {
                    const el = document.getElementById(noteId);
                    if (el) {
                        el.classList.remove('dragging');
                        el.style.zIndex = '';
                    }
                });
                this.isDraggingMultiple = false;
                this.multiDragOffsets.clear();
                this.saveData();
            }
            this.gridOverlay.classList.remove('snap-active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    // ---- Resize ----

    startResize(el, note, e) {
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = el.offsetWidth;
        const startH = el.offsetHeight;

        const onMove = (e) => {
            const newW = Math.max(180, startW + (e.clientX - startX));
            const newH = Math.max(120, startH + (e.clientY - startY));

            note.width = newW;
            note.height = newH;
            el.style.width = `${newW}px`;
            el.style.minHeight = `${newH}px`;
            el.style.maxHeight = `${newH}px`;
        };

        const onUp = () => {
            this.saveData();
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    // ---- Color Picker ----

    showColorPicker(noteId) {
        this.colorPickerTarget = noteId;
        this.colorPickerModal.classList.add('active');
    }

    hideColorPicker() {
        this.colorPickerModal.classList.remove('active');
        this.colorPickerTarget = null;
    }

    selectColor(color) {
        if (this.colorPickerTarget) {
            const note = this.notes.find(n => n.id === this.colorPickerTarget);
            const el = document.getElementById(this.colorPickerTarget);
            if (note && el) {
                note.color = color;
                el.style.backgroundColor = color;
                el.classList.toggle('dark-note', color === '#2d3436');
                this.saveData();
            }
        }
        this.hideColorPicker();
    }

    toggleColorDropdown() {
        this.colorDropdown.classList.toggle('active');
        this.updateColorSwatchSelection();
    }

    hideColorDropdown() {
        this.colorDropdown.classList.remove('active');
    }

    setDefaultColor(color) {
        this.defaultColor = color;
        this.colorPreview.style.background = color;
        this.updateColorSwatchSelection();
        this.saveData();
    }

    updateColorSwatchSelection() {
        this.colorDropdown.querySelectorAll('.color-swatch').forEach(s => {
            s.classList.toggle('selected', s.dataset.color === this.defaultColor);
        });
    }

    // ---- Modals ----

    showImageModal(imageUrl, noteText) {
        document.getElementById('modalImage').src = imageUrl;
        document.getElementById('modalNoteText').textContent = noteText || 'No text content';
        this.imageModal.classList.add('active');
    }

    hideImageModal() {
        this.imageModal.classList.remove('active');
    }

    showNoteModal(note) {
        this.currentEditingNote = note;

        const modalImage = document.getElementById('modalNoteImage');
        const modalTextarea = document.getElementById('modalNoteTextarea');
        const modalTimestamp = document.getElementById('modalTimestamp');

        if (note.imageUrl) {
            modalImage.src = note.imageUrl;
            modalImage.style.display = 'block';
        } else {
            modalImage.style.display = 'none';
        }

        modalTextarea.value = note.content;
        modalTimestamp.textContent = note.timestamp ? new Date(note.timestamp).toLocaleString() : '';

        this.noteModal.classList.add('active');
        setTimeout(() => modalTextarea.focus(), 100);

        // Use a stored bound function so we can properly remove it
        this._boundModalInput = (e) => {
            if (!this.currentEditingNote) return;
            this.currentEditingNote.content = e.target.value;

            const noteEl = document.getElementById(this.currentEditingNote.id);
            if (noteEl) {
                noteEl.querySelector('.note-textarea').value = this.currentEditingNote.content;
            }
            this.saveData();
        };

        modalTextarea.addEventListener('input', this._boundModalInput);
    }

    hideNoteModal() {
        this.noteModal.classList.remove('active');

        if (this._boundModalInput) {
            document.getElementById('modalNoteTextarea').removeEventListener('input', this._boundModalInput);
            this._boundModalInput = null;
        }
        this.currentEditingNote = null;
    }

    toggleShortcutsModal() {
        this.shortcutsModal.classList.toggle('active');
    }

    hideShortcutsModal() {
        this.shortcutsModal.classList.remove('active');
    }

    handleEscape() {
        if (this.noteModal.classList.contains('active')) {
            this.hideNoteModal();
        } else if (this.shortcutsModal.classList.contains('active')) {
            this.hideShortcutsModal();
        } else if (this.colorPickerModal.classList.contains('active')) {
            this.hideColorPicker();
        } else if (this.imageModal.classList.contains('active')) {
            this.hideImageModal();
        } else if (this.searchQuery) {
            this.searchInput.value = '';
            this.handleSearch();
        } else {
            this.clearSelection();
        }
    }

    // ---- Search ----

    handleSearch() {
        this.searchQuery = this.searchInput.value.trim().toLowerCase();
        this.clearSearchBtn.style.display = this.searchQuery ? 'block' : 'none';
        this.applySearchFilter();
    }

    applySearchFilter() {
        this.notes.forEach(note => {
            const el = document.getElementById(note.id);
            if (!el) return;

            if (!this.searchQuery) {
                el.classList.remove('search-hidden');
                return;
            }

            const matches = note.content.toLowerCase().includes(this.searchQuery);
            el.classList.toggle('search-hidden', !matches);
        });
    }

    // ---- Selection ----

    handleWorkspaceMouseDown(e) {
        if (e.target === this.workspace || e.target === this.gridOverlay) {
            this.startSelection(e);
        }
    }

    handleWorkspaceMouseMove(e) {
        if (this.isSelecting) this.updateSelection(e);
    }

    handleWorkspaceMouseUp() {
        if (this.isSelecting) this.endSelection();
    }

    startSelection(e) {
        this.isSelecting = true;
        this.clearSelection();

        const rect = this.workspace.getBoundingClientRect();
        this.selectionStart.x = e.clientX - rect.left;
        this.selectionStart.y = e.clientY - rect.top;

        this.selectionBox.style.left = `${this.selectionStart.x}px`;
        this.selectionBox.style.top = `${this.selectionStart.y}px`;
        this.selectionBox.style.width = '0';
        this.selectionBox.style.height = '0';
        this.selectionBox.style.display = 'block';
    }

    updateSelection(e) {
        const rect = this.workspace.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        const left = Math.min(this.selectionStart.x, currentX);
        const top = Math.min(this.selectionStart.y, currentY);
        const width = Math.abs(currentX - this.selectionStart.x);
        const height = Math.abs(currentY - this.selectionStart.y);

        this.selectionBox.style.left = `${left}px`;
        this.selectionBox.style.top = `${top}px`;
        this.selectionBox.style.width = `${width}px`;
        this.selectionBox.style.height = `${height}px`;

        this.updateSelectedNotes(left, top, width, height);
    }

    endSelection() {
        this.isSelecting = false;
        this.selectionBox.style.display = 'none';
    }

    updateSelectedNotes(sLeft, sTop, sWidth, sHeight) {
        const workspaceRect = this.workspace.getBoundingClientRect();
        const sRight = sLeft + sWidth;
        const sBottom = sTop + sHeight;

        this.notes.forEach(note => {
            const el = document.getElementById(note.id);
            if (!el) return;

            const r = el.getBoundingClientRect();
            const nLeft = r.left - workspaceRect.left;
            const nTop = r.top - workspaceRect.top;
            const nRight = nLeft + r.width;
            const nBottom = nTop + r.height;

            const intersects = !(nRight < sLeft || nLeft > sRight || nBottom < sTop || nTop > sBottom);

            if (intersects) {
                this.selectedNotes.add(note.id);
                el.classList.add('selected');
            } else {
                this.selectedNotes.delete(note.id);
                el.classList.remove('selected');
            }
        });
    }

    selectAllNotes() {
        this.notes.forEach(note => {
            this.selectedNotes.add(note.id);
            const el = document.getElementById(note.id);
            if (el) el.classList.add('selected');
        });
    }

    clearSelection() {
        this.selectedNotes.clear();
        this.workspace.querySelectorAll('.sticky-note.selected').forEach(el => el.classList.remove('selected'));
    }

    deleteSelectedNotes() {
        if (this.selectedNotes.size === 0) return;
        if (this.selectedNotes.size > 1 && !confirm(`Delete ${this.selectedNotes.size} selected notes?`)) return;

        this.saveStateForUndo();

        const ids = Array.from(this.selectedNotes);
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
            this.notes = this.notes.filter(n => n.id !== id);
        });

        this.selectedNotes.clear();
        this.saveData();
        this.updateCounts();
        this.checkDropZoneVisibility();
    }

    // ---- Layout ----

    autoAlign() {
        const gridW = 270;
        const cols = Math.max(1, Math.floor(this.workspace.clientWidth / gridW));

        this.notes.forEach((note, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            note.x = this.gridSize + col * gridW;
            note.y = this.gridSize + row * (note.height ? note.height + 10 : 190);

            const el = document.getElementById(note.id);
            if (el) {
                el.style.left = `${note.x}px`;
                el.style.top = `${note.y}px`;
            }
        });
        this.saveData();
    }

    groupByColor() {
        const groups = {};
        this.notes.forEach(n => {
            (groups[n.color] = groups[n.color] || []).push(n);
        });

        let curX = 20;
        Object.values(groups).forEach(group => {
            group.forEach((note, i) => {
                note.x = curX;
                note.y = 20 + i * (note.height ? note.height + 10 : 190);
                const el = document.getElementById(note.id);
                if (el) {
                    el.style.left = `${note.x}px`;
                    el.style.top = `${note.y}px`;
                }
            });
            curX += 290;
        });
        this.saveData();
    }

    // ---- Grid & Snap ----

    toggleSnapMode() {
        this.snapMode = !this.snapMode;
        this.snapBtn.classList.toggle('active-toggle', this.snapMode);
    }

    toggleGrid() {
        this.gridVisible = !this.gridVisible;
        this.gridOverlay.classList.toggle('hidden', !this.gridVisible);
        this.gridOverlay.classList.toggle('active', this.gridVisible);
        this.gridToggleBtn.classList.toggle('active-toggle', this.gridVisible);
    }

    // ---- Theme ----

    changeTheme(theme) {
        document.body.className = '';
        if (theme !== 'default') document.body.classList.add(theme);
        this.currentTheme = theme;

        if (this.currentBoard !== 'default' && this.boards[this.currentBoard]) {
            this.boards[this.currentBoard].theme = theme;
        }
        this.saveData();
    }

    loadBoardTheme() {
        let theme = 'default';
        if (this.currentBoard !== 'default' && this.boards[this.currentBoard]) {
            theme = this.boards[this.currentBoard].theme || 'default';
        }
        this.themeSelect.value = theme;
        this.changeTheme(theme);
    }

    // ---- Boards ----

    createBoard() {
        const name = prompt('Enter board name:');
        if (!name || !name.trim()) return;

        const id = name.trim().toLowerCase().replace(/\s+/g, '_');
        if (this.boards[id]) {
            alert('Board already exists!');
            return;
        }

        this.boards[id] = { name: name.trim(), notes: [], theme: 'default' };
        this.updateBoardSelect();
        this.switchBoard(id);
        this.saveData();
    }

    deleteBoard() {
        if (this.currentBoard === 'default') {
            alert('Cannot delete default board!');
            return;
        }
        if (!confirm('Delete this board and all its notes?')) return;

        delete this.boards[this.currentBoard];
        this.updateBoardSelect();
        this.switchBoard('default');
        this.saveData();
    }

    switchBoard(boardId) {
        this.saveCurrentBoardNotes();
        this.saveCurrentBoardTheme();

        this.currentBoard = boardId;
        this.boardSelect.value = boardId;

        this.workspace.querySelectorAll('.sticky-note').forEach(n => n.remove());
        this.clearSelection();
        this.undoStack = [];

        this.loadCurrentBoardNotes();
        this.loadBoardTheme();
        this.updateCounts();
        this.checkDropZoneVisibility();
    }

    saveCurrentBoardNotes() {
        if (this.currentBoard !== 'default' && this.boards[this.currentBoard]) {
            this.boards[this.currentBoard].notes = [...this.notes];
        }
    }

    saveCurrentBoardTheme() {
        if (this.currentBoard !== 'default' && this.boards[this.currentBoard]) {
            this.boards[this.currentBoard].theme = this.currentTheme;
        }
    }

    loadCurrentBoardNotes() {
        if (this.currentBoard === 'default') {
            const saved = localStorage.getItem('stickyNotesApp');
            this.notes = saved ? (JSON.parse(saved).defaultNotes || []) : [];
        } else if (this.boards[this.currentBoard]) {
            this.notes = [...this.boards[this.currentBoard].notes];
        } else {
            this.notes = [];
        }

        this.notes.forEach(n => this.renderNote(n, true));
        this.updateDownloadButton();
    }

    updateBoardSelect() {
        while (this.boardSelect.children.length > 1) {
            this.boardSelect.removeChild(this.boardSelect.lastChild);
        }

        const defaultOption = this.boardSelect.querySelector('option[value="default"]');
        const saved = localStorage.getItem('stickyNotesApp');
        const defaultCount = this.currentBoard === 'default'
            ? this.notes.length
            : (saved ? (JSON.parse(saved).defaultNotes?.length || 0) : 0);
        defaultOption.textContent = `Default Board (${defaultCount})`;

        Object.entries(this.boards).forEach(([id, board]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = `${board.name} (${board.notes?.length || 0})`;
            this.boardSelect.appendChild(opt);
        });
    }

    updateBoardCount() {
        const opt = this.boardSelect.querySelector(`option[value="${this.currentBoard}"]`);
        if (opt) {
            const name = this.currentBoard === 'default' ? 'Default Board' : (this.boards[this.currentBoard]?.name || this.currentBoard);
            opt.textContent = `${name} (${this.notes.length})`;
        }
    }

    // ---- Clear ----

    clearAll() {
        if (!confirm('Delete all notes on this board?')) return;
        this.saveStateForUndo();
        this.workspace.querySelectorAll('.sticky-note').forEach(n => n.remove());
        this.notes = [];
        this.saveData();
        this.updateCounts();
        this.checkDropZoneVisibility();
    }

    // ---- Image Drop ----

    handleImageDrop(e) {
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        files.forEach((file, i) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const x = Math.random() * Math.max(0, this.workspace.clientWidth - 250);
                const y = Math.random() * Math.max(0, this.workspace.clientHeight - 180) + i * 20;
                this.createNote(x, y, '', ev.target.result);
            };
            reader.readAsDataURL(file);
        });
    }

    // ---- Drop zone ----

    checkDropZoneVisibility() {
        this.dropZone.style.display = this.notes.length === 0 ? 'block' : 'none';
    }

    hideDropZone() {
        this.dropZone.style.display = 'none';
    }

    // ---- Undo ----

    saveStateForUndo() {
        this.undoStack.push({
            notes: JSON.parse(JSON.stringify(this.notes)),
            noteIdCounter: this.noteIdCounter
        });
        if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        const prev = this.undoStack.pop();

        this.workspace.querySelectorAll('.sticky-note').forEach(n => n.remove());
        this.clearSelection();

        this.notes = prev.notes;
        this.noteIdCounter = prev.noteIdCounter;
        this.notes.forEach(n => this.renderNote(n, true));

        this.saveData();
        this.updateCounts();
        this.checkDropZoneVisibility();
    }

    updateUndoButton() {
        this.undoBtn.disabled = this.undoStack.length === 0;
    }

    updateDownloadButton() {
        this.downloadBtn.disabled = this.notes.length === 0;
    }

    updateCounts() {
        this.updateBoardCount();
        this.updateUndoButton();
        this.updateDownloadButton();
    }

    // ---- Persistence ----

    saveData() {
        this.saveCurrentBoardTheme();

        const saved = localStorage.getItem('stickyNotesApp');
        const existing = saved ? JSON.parse(saved) : {};

        const data = {
            boards: this.boards,
            currentBoard: this.currentBoard,
            defaultNotes: this.currentBoard === 'default' ? this.notes : (existing.defaultNotes || []),
            defaultTheme: this.currentBoard === 'default' ? this.currentTheme : (existing.defaultTheme || 'default'),
            noteIdCounter: this.noteIdCounter,
            defaultColor: this.defaultColor,
            currentTheme: this.currentTheme
        };

        if (this.currentBoard !== 'default' && this.boards[this.currentBoard]) {
            this.boards[this.currentBoard].notes = [...this.notes];
            this.boards[this.currentBoard].theme = this.currentTheme;
            data.boards = this.boards;
        }

        localStorage.setItem('stickyNotesApp', JSON.stringify(data));
    }

    loadData() {
        const saved = localStorage.getItem('stickyNotesApp');
        if (saved) {
            const data = JSON.parse(saved);
            this.boards = data.boards || {};
            this.noteIdCounter = data.noteIdCounter || 0;
            this.defaultColor = data.defaultColor || '#fff740';
            this.currentTheme = data.currentTheme || 'default';

            this.colorPreview.style.background = this.defaultColor;
            this.updateBoardSelect();
            this.switchBoard(data.currentBoard || 'default');
        } else {
            this.notes = [];
            this.colorPreview.style.background = this.defaultColor;
            this.checkDropZoneVisibility();
            this.updateBoardCount();
        }

        this.updateUndoButton();
        this.updateDownloadButton();
    }

    // ---- Download ----

    downloadNotes() {
        if (this.notes.length === 0) return;

        const sorted = [...this.notes].sort((a, b) => {
            if (Math.abs(a.y - b.y) < 50) return a.x - b.x;
            return a.y - b.y;
        });

        const boardName = this.currentBoard === 'default' ? 'Default Board' : (this.boards[this.currentBoard]?.name || this.currentBoard);
        let content = `Craft Notes - ${boardName}\nGenerated: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;

        sorted.forEach((note, i) => {
            content += `${i + 1}. ${note.done ? '[DONE] ' : ''}`;
            content += note.content.trim() || '[Empty note]';
            if (note.imageUrl) content += ' [image]';
            content += '\n\n';
        });

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `craft-notes-${this.currentBoard}-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ---- Import / Export ----

    exportJSON() {
        this.saveCurrentBoardNotes();
        const data = localStorage.getItem('stickyNotesApp');
        if (!data) {
            alert('Nothing to export.');
            return;
        }

        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `craft-notes-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    importJSON(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                if (!data.noteIdCounter && data.noteIdCounter !== 0) {
                    throw new Error('Invalid backup file');
                }
                if (!confirm('This will replace all your current data. Continue?')) return;

                localStorage.setItem('stickyNotesApp', JSON.stringify(data));
                location.reload();
            } catch (err) {
                alert('Invalid backup file: ' + err.message);
            }
        };
        reader.readAsText(file);

        // Reset file input so the same file can be re-imported
        e.target.value = '';
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    new StickyNotesApp();
});
