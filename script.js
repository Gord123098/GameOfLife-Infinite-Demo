class ChunkManager {
    constructor(chunkSize = 64) {
        this.chunkSize = chunkSize;
        this.chunks = new Map(); // "x,y" -> Uint8Array
        this.keyCache = new Map(); // Optimization to reduce string allocs if needed, or just use strings
    }

    getChunkKey(cx, cy) {
        return `${cx},${cy}`;
    }

    getChunk(cx, cy) {
        return this.chunks.get(this.getChunkKey(cx, cy));
    }

    getOrCreateChunk(cx, cy) {
        const key = this.getChunkKey(cx, cy);
        let chunk = this.chunks.get(key);
        if (!chunk) {
            chunk = new Uint8Array(this.chunkSize * this.chunkSize);
            this.chunks.set(key, chunk);
        }
        return chunk;
    }

    setCell(x, y, state) {
        const cx = Math.floor(x / this.chunkSize);
        const cy = Math.floor(y / this.chunkSize);
        const lx = ((x % this.chunkSize) + this.chunkSize) % this.chunkSize;
        const ly = ((y % this.chunkSize) + this.chunkSize) % this.chunkSize;

        const chunk = this.getOrCreateChunk(cx, cy);
        chunk[ly * this.chunkSize + lx] = state;
    }

    getCell(x, y) {
        const cx = Math.floor(x / this.chunkSize);
        const cy = Math.floor(y / this.chunkSize);
        const chunk = this.chunks.get(this.getChunkKey(cx, cy));

        if (!chunk) return 0;

        const lx = ((x % this.chunkSize) + this.chunkSize) % this.chunkSize;
        const ly = ((y % this.chunkSize) + this.chunkSize) % this.chunkSize;

        return chunk[ly * this.chunkSize + lx];
    }

    clear() {
        this.chunks.clear();
    }
}

class GameOfLife {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { alpha: false });

        this.chunkSize = 32; // Smaller chunks for cleaner sparse updates
        this.grid = new ChunkManager(this.chunkSize);
        // We need a secondary grid for next state. 
        // We can just construct a new ChunkManager each tick or swap.
        // Let's swap simple objects.

        // Camera
        this.zoom = 4;
        this.offsetX = 0;
        this.offsetY = 0;
        this.minZoom = 0.5;
        this.maxZoom = 40;

        // Rules
        this.bornRules = new Set([3]);
        this.surviveRules = new Set([2, 3]);

        this.isRunning = false;
        this.fps = 30;
        this.lastFrameTime = 0;
        this.animationId = null;

        this.generation = 0;
        this.population = 0;

        // Visuals
        this.liveColor = '#38bdf8';
        this.deadColor = '#0f172a';

        this.isDragging = false;
        this.isDrawing = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.drawState = 1;

        this.init();
    }

    init() {
        console.log("Game initialized (Infinite)");
        this.resize();
        window.addEventListener('resize', () => {
            this.resize();
            this.draw();
        });

        this.setupControls();
        this.setupRulesUI();
        this.setupInteractions();

        this.centerCamera();

        // Initial random cloud
        this.randomize();
        this.draw();
    }

    centerCamera() {
        this.offsetX = this.canvas.width / 2;
        this.offsetY = this.canvas.height / 2;
    }

    resize() {
        const parent = this.canvas.parentElement;
        if (parent.clientWidth === 0 || parent.clientHeight === 0) return;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        this.draw();
    }

    setupControls() {
        this.startBtn = document.getElementById('startBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.randomBtn = document.getElementById('randomBtn');
        this.speedRange = document.getElementById('speedRange');
        this.densityRange = document.getElementById('densityRange');
        this.genDisplay = document.getElementById('generationDisplay');
        this.popDisplay = document.getElementById('populationDisplay');
        this.patternSelect = document.getElementById('patternSelect');
        this.ruleSelect = document.getElementById('ruleSelect');

        this.startBtn.addEventListener('click', () => this.start());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.clearBtn.addEventListener('click', () => this.clear());
        this.randomBtn.addEventListener('click', () => this.randomize());

        this.speedRange.addEventListener('input', (e) => this.fps = parseInt(e.target.value));

        // Patterns
        if (window.PATTERNS) {
            for (const name of Object.keys(window.PATTERNS)) {
                if (name === "Clear") continue;
                const option = document.createElement('option');
                option.value = name;
                option.innerText = name;
                this.patternSelect.appendChild(option);
            }
        }
        this.patternSelect.addEventListener('change', (e) => {
            if (e.target.value && window.PATTERNS[e.target.value]) {
                this.loadPattern(window.PATTERNS[e.target.value]);
            }
            e.target.value = "";
        });
    }

    setupRulesUI() {
        // Born Checkboxes (1-8)
        const bornContainer = document.getElementById('bornChecks');
        for (let i = 1; i <= 8; i++) {
            const chk = this.createRuleCheckbox(i, this.bornRules.has(i), (val, checked) => {
                if (checked) this.bornRules.add(val); else this.bornRules.delete(val);
            });
            bornContainer.appendChild(chk);
        }

        // Survive Checkboxes (0-8)
        const surviveContainer = document.getElementById('surviveChecks');
        for (let i = 0; i <= 8; i++) {
            const chk = this.createRuleCheckbox(i, this.surviveRules.has(i), (val, checked) => {
                if (checked) this.surviveRules.add(val); else this.surviveRules.delete(val);
            });
            surviveContainer.appendChild(chk);
        }

        // Rule Presets
        if (window.RULES) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.innerText = "Select Rule...";
            this.ruleSelect.appendChild(opt);

            for (const [name, rule] of Object.entries(window.RULES)) {
                const option = document.createElement('option');
                option.value = name;
                option.innerText = name;
                this.ruleSelect.appendChild(option);
            }
        }

        this.ruleSelect.addEventListener('change', (e) => {
            const ruleName = e.target.value;
            if (ruleName && window.RULES[ruleName]) {
                this.applyRule(window.RULES[ruleName]);
            }
        });

        // Set initial UI state
        this.updateRuleUI();
    }

    createRuleCheckbox(val, checked, onChange) {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.justifyContent = 'center';
        label.style.width = '16px';
        label.style.height = '16px';
        label.style.fontSize = '0.7rem';
        label.style.cursor = 'pointer';
        label.style.userSelect = 'none';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.style.display = 'none';

        const span = document.createElement('span');
        span.innerText = val;
        span.className = 'rule-chk';
        span.style.color = checked ? '#38bdf8' : '#64748b';
        span.style.fontWeight = checked ? 'bold' : 'normal';

        input.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            span.style.color = isChecked ? '#38bdf8' : '#64748b';
            span.style.fontWeight = isChecked ? 'bold' : 'normal';
            onChange(val, isChecked);
        });

        label.appendChild(input);
        label.appendChild(span);
        return label;
    }

    updateRuleUI() {
        // Update checkbox visuals if rule changed externally
        const bInputs = document.getElementById('bornChecks').querySelectorAll('input');
        const sInputs = document.getElementById('surviveChecks').querySelectorAll('input');
        const bSpans = document.getElementById('bornChecks').querySelectorAll('span');
        const sSpans = document.getElementById('surviveChecks').querySelectorAll('span');

        bInputs.forEach((inp, i) => {
            const val = i + 1;
            inp.checked = this.bornRules.has(val);
            bSpans[i].style.color = inp.checked ? '#38bdf8' : '#64748b';
            bSpans[i].style.fontWeight = inp.checked ? 'bold' : 'normal';
        });

        sInputs.forEach((inp, i) => {
            const val = i;
            inp.checked = this.surviveRules.has(val);
            sSpans[i].style.color = inp.checked ? '#38bdf8' : '#64748b';
            sSpans[i].style.fontWeight = inp.checked ? 'bold' : 'normal';
        });
    }

    applyRule(rule) {
        this.bornRules.clear();
        rule.b.forEach(n => this.bornRules.add(n));
        this.surviveRules.clear();
        rule.s.forEach(n => this.surviveRules.add(n));
        this.updateRuleUI();
    }

    setupInteractions() {
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mouseup', () => this.handleMouseUp());
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) { e.preventDefault(); this.handleMouseDown(e.touches[0]); }
        }, { passive: false });
        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) { e.preventDefault(); this.handleMouseMove(e.touches[0]); }
        }, { passive: false });
    }

    screenToGrid(sx, sy) {
        const x = Math.floor((sx - this.offsetX) / this.zoom);
        const y = Math.floor((sy - this.offsetY) / this.zoom);
        return { x, y };
    }

    handleMouseDown(e) {
        if (e.button === 1 || e.button === 2) {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            return;
        }

        this.isDrawing = true;
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToGrid(e.clientX - rect.left, e.clientY - rect.top);

        this.drawState = this.grid.getCell(x, y) ? 0 : 1;
        this.grid.setCell(x, y, this.drawState);
        this.draw();
    }

    handleMouseMove(e) {
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        if (this.isDragging) {
            const dx = mouseX - this.lastMouseX;
            const dy = mouseY - this.lastMouseY;
            this.offsetX += dx;
            this.offsetY += dy;
            this.lastMouseX = mouseX;
            this.lastMouseY = mouseY;
            this.draw();
            return;
        }

        if (this.isDrawing) {
            const rect = this.canvas.getBoundingClientRect();
            const { x, y } = this.screenToGrid(mouseX - rect.left, mouseY - rect.top);
            if (this.grid.getCell(x, y) !== this.drawState) {
                this.grid.setCell(x, y, this.drawState);
                if (!this.isRunning) this.draw();
            }
        }
    }

    handleMouseUp() {
        this.isDragging = false;
        this.isDrawing = false;
    }

    handleWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const gridX = (mouseX - this.offsetX) / this.zoom;
        const gridY = (mouseY - this.offsetY) / this.zoom;

        const delta = -Math.sign(e.deltaY);
        const newZoom = this.zoom * (1 + delta * 0.1);

        if (newZoom >= this.minZoom && newZoom <= this.maxZoom) {
            this.zoom = newZoom;
            this.offsetX = mouseX - gridX * this.zoom;
            this.offsetY = mouseY - gridY * this.zoom;
            this.draw();
        }
    }

    loadPattern(pattern) {
        const rect = this.canvas.getBoundingClientRect();
        // Place in center of screen
        const { x, y } = this.screenToGrid(rect.width / 2, rect.height / 2);

        const startX = x - Math.floor(pattern[0].length / 2);
        const startY = y - Math.floor(pattern.length / 2);

        for (let py = 0; py < pattern.length; py++) {
            for (let px = 0; px < pattern[py].length; px++) {
                if (pattern[py][px]) {
                    this.grid.setCell(startX + px, startY + py, 1);
                }
            }
        }
        this.draw();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = false;
        this.lastFrameTime = performance.now();
        this.loop();
    }

    pause() {
        this.isRunning = false;
        this.startBtn.disabled = false;
        this.pauseBtn.disabled = true;
        cancelAnimationFrame(this.animationId);
    }

    clear() {
        this.grid.clear();
        this.generation = 0;
        this.population = 0;
        this.draw();
        this.updateStats();
        if (this.isRunning) this.pause();
    }

    randomize() {
        this.clear();
        const density = parseFloat(this.densityRange.value);

        // Randomize fills the visible screen bounds
        const startGrid = this.screenToGrid(0, 0);
        const endGrid = this.screenToGrid(this.canvas.width, this.canvas.height);

        // Add padding to fill partially visible chunks perfectly
        for (let y = startGrid.y - 1; y <= endGrid.y + 1; y++) {
            for (let x = startGrid.x - 1; x <= endGrid.x + 1; x++) {
                if (Math.random() < density) {
                    this.grid.setCell(x, y, 1);
                }
            }
        }

        this.draw();
    }

    computeNextGen() {
        const nextGrid = new ChunkManager(this.chunkSize);
        // We need to check all cells that are "alive" + their neighbors.
        // Efficient way:
        // 1. Iterate all keys in current chunks.
        // 2. Determine "Active Region" of chunks (chunks with active cells).
        // 3. Process active chunks + 8 neighbors.

        const chunksToCheck = new Set();

        for (const [key, chunk] of this.grid.chunks) {
            // Only if chunk is not empty? Sparse optimization can go deeper (chunk has count).
            // But checking every cell in chunk is fine.
            const [cx, cy] = key.split(',').map(Number);

            // Add self and neighbors
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    chunksToCheck.add(`${cx + dx},${cy + dy}`);
                }
            }
        }

        let newPop = 0;

        // Process chunks
        for (const key of chunksToCheck) {
            const [cx, cy] = key.split(',').map(Number);

            // We need to iterate every cell in this chunk and check neighbors
            // Neighbors might come from other chunks.
            const chunkBaseX = cx * this.chunkSize;
            const chunkBaseY = cy * this.chunkSize;

            let chunkHasLife = false;

            for (let ly = 0; ly < this.chunkSize; ly++) {
                for (let lx = 0; lx < this.chunkSize; lx++) {
                    const gx = chunkBaseX + lx;
                    const gy = chunkBaseY + ly;

                    let neighbors = 0;

                    // Count neighbors
                    // Check local neighborhood (-1 to 1)

                    // Optimization: We are accessing getCell a lot. 
                    // Can be optimized by caching current 3x3 chunks? 
                    // For JS implementation, simple getCell is roughly OK but slowish.
                    // Let's stick to getCell for correctness first (Coordinate hashing overhead).

                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            if (this.grid.getCell(gx + dx, gy + dy)) neighbors++;
                        }
                    }

                    const state = this.grid.getCell(gx, gy);
                    let nextState = 0;

                    if (state === 1) {
                        if (this.surviveRules.has(neighbors)) nextState = 1;
                    } else {
                        if (this.bornRules.has(neighbors)) nextState = 1;
                    }

                    if (nextState) {
                        nextGrid.setCell(gx, gy, 1);
                        newPop++;
                        chunkHasLife = true;
                    }
                }
            }
        }

        this.grid = nextGrid;
        this.generation++;
        this.population = newPop;
    }

    draw() {
        this.ctx.fillStyle = this.deadColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.fillStyle = this.liveColor;

        // Determine visible chunks
        const startGrid = this.screenToGrid(0, 0);
        const endGrid = this.screenToGrid(this.canvas.width, this.canvas.height);

        // Pad slightly
        const minX = startGrid.x - 1;
        const minY = startGrid.y - 1;
        const maxX = endGrid.x + 1;
        const maxY = endGrid.y + 1;

        // Convert to chunk coords
        const minCX = Math.floor(minX / this.chunkSize);
        const minCY = Math.floor(minY / this.chunkSize);
        const maxCX = Math.floor(maxX / this.chunkSize);
        const maxCY = Math.floor(maxY / this.chunkSize);

        const size = Math.max(0.5, this.zoom - (this.zoom > 3 ? 0.5 : 0));

        // Iterate visible chunks
        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const chunk = this.grid.getChunk(cx, cy);
                if (!chunk) continue;

                const chunkBaseX = cx * this.chunkSize;
                const chunkBaseY = cy * this.chunkSize;

                for (let i = 0; i < chunk.length; i++) {
                    if (chunk[i]) {
                        const ly = Math.floor(i / this.chunkSize);
                        const lx = i % this.chunkSize;
                        const gx = chunkBaseX + lx;
                        const gy = chunkBaseY + ly;

                        // Culling exact bounds
                        if (gx < minX || gx > maxX || gy < minY || gy > maxY) continue;

                        this.ctx.fillRect(
                            this.offsetX + gx * this.zoom,
                            this.offsetY + gy * this.zoom,
                            size, size
                        );
                    }
                }
            }
        }

        this.updateStats();
    }

    updateStats() {
        if (this.genDisplay) this.genDisplay.innerText = this.generation;
        if (this.popDisplay) this.popDisplay.innerText = this.population;
    }

    loop() {
        if (!this.isRunning) return;

        const now = performance.now();
        const elapsed = now - this.lastFrameTime;
        const fpsInterval = 1000 / this.fps;

        if (elapsed > fpsInterval) {
            this.lastFrameTime = now - (elapsed % fpsInterval);
            this.computeNextGen();
            this.draw();
        }

        this.animationId = requestAnimationFrame(() => this.loop());
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.game = new GameOfLife('gameCanvas');
});
