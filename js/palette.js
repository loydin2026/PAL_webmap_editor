const PaletteModule = (function() {
    let palette = null; // Uint8Array(256*4) RGBA

    // 仙剑的调色板存储在 Pat.mkf 第 0 条记录中
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
        const offset0 = view.getUint32(0, true); // 记录 0 的偏移
        const offset1 = view.getUint32(4, true); // 记录 1 的偏移
        const recordLen = offset1 - offset0;

        const record = data.slice(offset0, offset1);
        
        // 解析调色板：3*512 字节，但只用前 256 个颜色
        palette = new Uint8Array(256 * 4); // RGBA
        const rate = 0.2;

        for (let i = 0; i < 255; i++) {
            let r = record[i * 3 + 0] * 4;
            let g = record[i * 3 + 1] * 4;
            let b = record[i * 3 + 2] * 4;

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
        let r255 = record[255 * 3 + 0] * 4;
        let g255 = record[255 * 3 + 1] * 4;
        let b255 = record[255 * 3 + 2] * 4;
        palette[255 * 4 + 0] = r255;
        palette[255 * 4 + 1] = g255;
        palette[255 * 4 + 2] = b255;
        palette[255 * 4 + 3] = 255;

        // 设置透明色：RGB(108, 88, 100) 对应索引？
        // 原代码中 TransparentBlt 使用 RGB(108, 88, 100) 作为透明色
        // 这里我们需要找到最接近的调色板索引，或者直接在解码时跳过该颜色
        // 但原代码是像素级的透明色，不是调色板索引透明
        // 所以我们需要在生成 ImageData 时做透明处理

        return palette;
    }

    function getPalette() {
        return palette;
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
        parseFromBuffer
    };
})();
