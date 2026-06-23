const PaletteModule = (function() {
    let palettes = []; // Array of Uint8Array(256*4) RGBA
    let currentPaletteIndex = 0;

    // 仙剑的调色板存储在 Pat.mkf 中
    // 格式：3*512 字节，每 3 字节为 (R,G,B)，每个值 0-63
    async function load(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const buffer = await response.arrayBuffer();
            return parseFromBuffer(new Uint8Array(buffer));
        } catch (e) {
            console.warn('fetch palette failed, trying file upload fallback:', e);
            return null;
        }
    }

    function parseFromBuffer(data) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        
        // 读取 MKF 偏移量表
        const offsets = [];
        let idx = 0;
        let prevOff = 0;
        while (idx * 4 + 4 <= data.byteLength) {
            const off = view.getUint32(idx * 4, true);
            if (off === 0 || off <= prevOff || off > data.byteLength) break;
            offsets.push(off);
            prevOff = off;
            idx++;
        }
        
        palettes = [];
        const MAX_PALETTES = 10; // PAT.MKF 包含 10 条调色板
        
        // 逐条记录提取调色板，每条记录可能包含多个 768 字节的调色板
        for (let r = 0; r < offsets.length - 1 && palettes.length < MAX_PALETTES; r++) {
            const start = offsets[r];
            const end = offsets[r + 1];
            const recordLen = end - start;
            const palettesInRecord = Math.floor(recordLen / 768);
            
            for (let p = 0; p < palettesInRecord && palettes.length < MAX_PALETTES; p++) {
                const paletteOffset = start + p * 768;
                const palette = new Uint8Array(256 * 4); // RGBA
                const rate = 0.2;

                for (let i = 0; i < 255; i++) {
                    let r = data[paletteOffset + i * 3 + 0] * 4;
                    let g = data[paletteOffset + i * 3 + 1] * 4;
                    let b = data[paletteOffset + i * 3 + 2] * 4;

                    // 提高饱和度
                    r += Math.floor((255 - r) * rate);
                    g += Math.floor((255 - g) * rate);
                    b += Math.floor((255 - b) * rate);

                    palette[i * 4 + 0] = r;
                    palette[i * 4 + 1] = g;
                    palette[i * 4 + 2] = b;
                    palette[i * 4 + 3] = 255; // 默认不透明
                }

                // 关键色（索引 255）不做饱和度调整
                let r255 = data[paletteOffset + 255 * 3 + 0] * 4;
                let g255 = data[paletteOffset + 255 * 3 + 1] * 4;
                let b255 = data[paletteOffset + 255 * 3 + 2] * 4;
                palette[255 * 4 + 0] = r255;
                palette[255 * 4 + 1] = g255;
                palette[255 * 4 + 2] = b255;
                palette[255 * 4 + 3] = 255;

                palettes.push(palette);
            }
        }

        currentPaletteIndex = 0;
        return palettes;
    }

    function getPalette() {
        return palettes[currentPaletteIndex] || null;
    }

    function getPalettes() {
        return palettes;
    }

    function getPaletteCount() {
        return palettes.length;
    }

    function setPaletteIndex(index) {
        if (index >= 0 && index < palettes.length) {
            currentPaletteIndex = index;
            return true;
        }
        return false;
    }

    function getPaletteIndex() {
        return currentPaletteIndex;
    }

    function loadFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                try {
                    resolve(parseFromBuffer(data));
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    return {
        load,
        loadFromFile,
        getPalette,
        getPalettes,
        getPaletteCount,
        setPaletteIndex,
        getPaletteIndex,
        parseFromBuffer
    };
})();
