class SpatialGrid {
    constructor(width, height, cellSize) {
        this.width = width;
        this.height = height;
        this.cellSize = cellSize;
        this.cols = Math.ceil(width / cellSize);
        this.rows = Math.ceil(height / cellSize);
        this.cells = new Array(this.cols * this.rows).fill(null).map(() => []);
        this.particleCellMap = new Map(); // Store which cell each particle is in
    }

    _getCellCoords(x, y) {
        const cellX = Math.floor(x / this.cellSize);
        const cellY = Math.floor(y / this.cellSize);
        // Clamp coordinates to grid boundaries
        return {
            x: Math.max(0, Math.min(this.cols - 1, cellX)),
            y: Math.max(0, Math.min(this.rows - 1, cellY)),
        };
    }

    _getCellIndex(cellX, cellY) {
        return cellY * this.cols + cellX;
    }

    add(particle) {
        const { x: cellX, y: cellY } = this._getCellCoords(particle.x, particle.y);
        const cellIndex = this._getCellIndex(cellX, cellY);
        this.cells[cellIndex].push(particle);
        this.particleCellMap.set(particle, cellIndex);
    }

    remove(particle) {
        const cellIndex = this.particleCellMap.get(particle);
        if (cellIndex !== undefined) {
            const cell = this.cells[cellIndex];
            const particleIndex = cell.indexOf(particle);
            if (particleIndex > -1) {
                cell.splice(particleIndex, 1);
            }
            this.particleCellMap.delete(particle);
        }
    }

    update(particle) {
        const oldCellIndex = this.particleCellMap.get(particle);
        const { x: newCellX, y: newCellY } = this._getCellCoords(particle.x, particle.y);
        const newCellIndex = this._getCellIndex(newCellX, newCellY);

        if (oldCellIndex !== newCellIndex) {
            // Remove from old cell
            if (oldCellIndex !== undefined) {
                const oldCell = this.cells[oldCellIndex];
                const particleIndex = oldCell.indexOf(particle);
                if (particleIndex > -1) {
                    oldCell.splice(particleIndex, 1);
                }
            }
            // Add to new cell
            this.cells[newCellIndex].push(particle);
            this.particleCellMap.set(particle, newCellIndex);
        }
    }

    getNearby(particle) {
        const nearbyParticles = new Set();
        const { x: cellX, y: cellY } = this._getCellCoords(particle.x, particle.y);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const checkX = cellX + dx;
                const checkY = cellY + dy;

                // Check if the neighbor cell is within grid bounds
                if (checkX >= 0 && checkX < this.cols && checkY >= 0 && checkY < this.rows) {
                    const cellIndex = this._getCellIndex(checkX, checkY);
                    for (const p of this.cells[cellIndex]) {
                        // Don't add the particle itself
                        if (p !== particle) {
                            nearbyParticles.add(p);
                        }
                    }
                }
                // Basic Toroidal wrapping check (only for adjacent cells crossing boundaries)
                // This is a simplified check; more robust toroidal grids are complex.
                else {
                    let wrappedX = checkX;
                    let wrappedY = checkY;
                    if (wrappedX < 0) wrappedX = this.cols - 1;
                    else if (wrappedX >= this.cols) wrappedX = 0;
                    if (wrappedY < 0) wrappedY = this.rows - 1;
                    else if (wrappedY >= this.rows) wrappedY = 0;

                    // Only check if wrapping actually occurred and it's a direct neighbor
                    if ((wrappedX !== checkX || wrappedY !== checkY) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
                         const cellIndex = this._getCellIndex(wrappedX, wrappedY);
                         if (this.cells[cellIndex]) { // Ensure cell exists
                            for (const p of this.cells[cellIndex]) {
                                if (p !== particle) {
                                    nearbyParticles.add(p);
                                }
                            }
                         }
                    }
                }
            }
        }
        return nearbyParticles;
    }

    clear() {
        this.cells = new Array(this.cols * this.rows).fill(null).map(() => []);
        this.particleCellMap.clear();
    }
}
