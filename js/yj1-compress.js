const YJ1Compress = (function() {
    "use strict";

    const BLOCK_SIZE = 0x4000;

    // 计算表示一个无符号整数所需的位数（0 返回 0）
    function getBitCount(word) {
        if (word === 0) return 0;
        let bits = 0;
        while (word) {
            bits++;
            word >>>= 1;
        }
        return bits;
    }

    // 在 buf 的 baseAddr 偏移处（视为 uint16 小端数组起点），
    // 设置相对于 baseAddr 的 bitptr 位（高位在前）
    function setBit(buf, baseAddr, bitptr, bit) {
        const relByte = (Math.floor(bitptr / 16) * 2) + ((bitptr % 16) < 8 ? 1 : 0);
        const byteIdx = baseAddr + relByte;
        const bitInByte = (15 - (bitptr % 16)) % 8;
        if (bit) {
            buf[byteIdx] |= (1 << bitInByte);
        } else {
            buf[byteIdx] &= ~(1 << bitInByte);
        }
    }

    // 设置多比特（取 data 的低 count 位，高位先写入）
    function setBits(buf, baseAddr, bitptr, data, count) {
        for (let i = 0; i < count; i++) {
            const b = (data >> (count - 1 - i)) & 1;
            setBit(buf, baseAddr, bitptr + i, b);
        }
        return bitptr + count;
    }

    // 编码“同类编码的编码数”
    function setLoop(buf, baseAddr, bitptr, count, header) {
        if (count === header.CodeCountTable[0]) {
            setBit(buf, baseAddr, bitptr, true);
            return bitptr + 1;
        } else {
            setBit(buf, baseAddr, bitptr, false);
            bitptr++;
            if (count === header.CodeCountTable[1]) {
                return setBits(buf, baseAddr, bitptr, 0, 2);
            } else {
                const cnt = getBitCount(count);
                for (let j = 0; j < 3; j++) {
                    if (cnt <= header.CodeCountCodeLengthTable[j]) {
                        bitptr = setBits(buf, baseAddr, bitptr, j + 1, 2);
                        return setBits(buf, baseAddr, bitptr, count, header.CodeCountCodeLengthTable[j]);
                    }
                }
            }
            return bitptr;
        }
    }

    // 编码 LZSS 重复次数
    function setCount(buf, baseAddr, bitptr, matchLen, header) {
        for (let k = 0; k < 4; k++) {
            if (matchLen === header.LZSSRepeatTable[k]) {
                bitptr = setBits(buf, baseAddr, bitptr, k, 2);
                if (k > 0) {
                    setBit(buf, baseAddr, bitptr, false);
                    bitptr++;
                }
                return bitptr;
            }
        }
        const cnt = getBitCount(matchLen);
        for (let k = 0; k < 3; k++) {
            if (cnt <= header.LZSSRepeatCodeLengthTable[k]) {
                bitptr = setBits(buf, baseAddr, bitptr, k + 1, 2);
                setBit(buf, baseAddr, bitptr, true);
                bitptr++;
                return setBits(buf, baseAddr, bitptr, matchLen, header.LZSSRepeatCodeLengthTable[k]);
            }
        }
        return bitptr;
    }

    // LZSS 分析
    function lzAnalysize(base, blockLen, freq) {
        const head = new Int32Array(0x100).fill(-1);
        const prev = new Int32Array(0x4000).fill(-1);

        for (let ptr = 0; ptr < blockLen - 1; ptr++) {
            const hash = base[ptr] ^ base[ptr + 1];
            if (head[hash] >= 0) {
                prev[ptr] = head[hash];
            }
            head[hash] = ptr;
        }

        const result = new Uint16Array(0x5000);
        result[0] = 0;
        let dptr = 1;
        let baseptr = 0;

        for (let ptr = 0; ptr < blockLen; ) {
            let matchLen = 0;
            let matchPrv = -1;
            let tmp = ptr;

            while ((tmp = prev[tmp]) >= 0) {
                let matchLenT = 0;
                let prvT = tmp;
                let curT = ptr;
                while (prvT < blockLen && curT < blockLen && base[prvT] === base[curT] && matchLenT + ptr < blockLen) {
                    matchLenT++;
                    prvT++;
                    curT++;
                }
                if (matchLenT > 1 && matchLen < matchLenT) {
                    matchLen = matchLenT;
                    matchPrv = tmp;
                }
            }

            if (matchLen > 1 && matchLen < 5) {
                const bitCount = 5 + getBitCount(matchLen) + getBitCount(ptr - matchPrv);
                if (bitCount > (matchLen << 3)) {
                    matchLen = 1;
                }
            }

            if (matchLen > 1) {
                if (result[baseptr] > 0x8000 && result[baseptr] < 0xFFFF) {
                    result[baseptr]++;
                } else {
                    baseptr = dptr++;
                    result[baseptr] = 0x8001;
                }
                result[dptr++] = matchLen;
                result[dptr++] = ptr - matchPrv;
                ptr += matchLen;
            } else {
                if (!result[baseptr]) {
                    result[baseptr] = 0x1;
                } else if (result[baseptr] < 0x7FFF) {
                    result[baseptr]++;
                } else {
                    baseptr = dptr++;
                    result[baseptr] = 0x1;
                }
                freq[base[ptr++]]++;
            }
        }

        return {
            result: result.subarray(0, dptr),
            byteLength: dptr << 1
        };
    }

    // 块编码参数分析
    function cbAnalysize(header, block, cbLen) {
        let totalBits = 0;

        // 第一段：统计 count 值
        do {
            const count = new Uint32Array(0x100);
            const countLen = new Int32Array(15).fill(0);
            const totalLen = new Int32Array(15).fill(0);
            let max1 = 0, max2 = 0;

            for (let ptr = 0; ptr < (cbLen >> 1); ptr++) {
                const temp = block[ptr] & 0x7FFF;
                if (temp < 0x100) {
                    count[temp]++;
                    if (count[max1] < count[temp]) {
                        max2 = max1;
                        max1 = temp & 0xFF;
                    } else if (count[max2] < count[temp] && temp !== max1) {
                        max2 = temp & 0xFF;
                    }
                }
                countLen[getBitCount(temp)]++;
                if (block[ptr] & 0x8000) {
                    ptr += temp << 1;
                }
            }

            header.CodeCountTable[0] = max1;
            if (max2) {
                header.CodeCountTable[1] = max2;
            } else {
                header.CodeCountTable[1] = max1;
            }

            totalBits = count[max1] + count[max2] * 3;
            countLen[getBitCount(max1)] -= count[max1];
            countLen[getBitCount(max2)] -= count[max2];

            let max = 14, min = 1;
            while (max > 0 && !countLen[max]) max--;
            while (min < 15 && !countLen[min]) min++;

            if (max < min) {
                header.CodeCountCodeLengthTable[0] = 0;
                header.CodeCountCodeLengthTable[1] = 0;
                header.CodeCountCodeLengthTable[2] = 0;
                break;
            }

            for (let i = min; i <= max; i++) {
                totalLen[i] = totalLen[i - 1] + countLen[i];
            }

            header.CodeCountCodeLengthTable[0] = min;
            header.CodeCountCodeLengthTable[1] = max;
            header.CodeCountCodeLengthTable[2] = max;

            let totalMin = totalLen[min] * min + (totalLen[max] - totalLen[min]) * max;
            for (let i = min; i < max - 1; i++) {
                if (countLen[i]) {
                    for (let j = i + 1; j < max; j++) {
                        if (countLen[j]) {
                            const total = totalLen[i] * i + (totalLen[j] - totalLen[i]) * j + (totalLen[max] - totalLen[j]) * max;
                            if (total < totalMin) {
                                totalMin = total;
                                header.CodeCountCodeLengthTable[0] = i;
                                header.CodeCountCodeLengthTable[1] = j;
                            }
                        }
                    }
                }
            }

            totalBits += totalMin + totalLen[max] * 3;
        } while (0);

        // 第二段：统计 match_len
        do {
            const count = new Uint32Array(0x4000);
            const maxs = new Int32Array(4).fill(0);
            const countLen = new Int32Array(15).fill(0);
            const totalLen = new Int32Array(15).fill(0);

            for (let ptr = 0; ptr < (cbLen >> 1); ) {
                const temp = block[ptr] & 0x7FFF;
                if (block[ptr++] & 0x8000) {
                    for (let i = 0; i < temp; i++) {
                        const tmp = block[ptr++];
                        ptr++; // skip offset
                        count[tmp]++;
                        countLen[getBitCount(tmp)]++;

                        if (count[maxs[0]] < count[tmp]) {
                            let j;
                            for (j = 1; j < 4; j++) {
                                if (tmp === maxs[j]) {
                                    maxs[j] = maxs[0];
                                    maxs[0] = tmp;
                                    break;
                                }
                            }
                            if (j === 4) {
                                maxs[3] = maxs[2];
                                maxs[2] = maxs[1];
                                maxs[1] = maxs[0];
                                maxs[0] = tmp;
                            }
                        } else if (count[maxs[1]] < count[tmp] && tmp !== maxs[0]) {
                            let j;
                            for (j = 2; j < 4; j++) {
                                if (tmp === maxs[j]) {
                                    maxs[j] = maxs[1];
                                    maxs[1] = tmp;
                                    break;
                                }
                            }
                            if (j === 4) {
                                maxs[3] = maxs[2];
                                maxs[2] = maxs[1];
                                maxs[1] = tmp;
                            }
                        } else if (count[maxs[2]] < count[tmp] && tmp !== maxs[0] && tmp !== maxs[1]) {
                            maxs[3] = maxs[2];
                            maxs[2] = tmp;
                        } else if (count[maxs[3]] < count[tmp] && tmp !== maxs[0] && tmp !== maxs[1] && tmp !== maxs[2]) {
                            maxs[3] = tmp;
                        }
                    }
                }
            }

            totalBits += (count[maxs[0]] << 1) + (count[maxs[1]] + count[maxs[2]] + count[maxs[3]]) * 3;

            do {
                let lastmax = maxs[0];
                for (let i = 0; i < 4; i++) {
                    if (maxs[i]) {
                        countLen[getBitCount(maxs[i])] -= count[maxs[i]];
                        header.LZSSRepeatTable[i] = maxs[i];
                        lastmax = maxs[i];
                    } else {
                        header.LZSSRepeatTable[i] = lastmax;
                    }
                }
            } while (0);

            let max = 14, min = 1;
            while (max > 0 && !countLen[max]) max--;
            while (min < 15 && !countLen[min]) min++;

            if (max < min) {
                header.LZSSRepeatCodeLengthTable[0] = 0;
                header.LZSSRepeatCodeLengthTable[1] = 0;
                header.LZSSRepeatCodeLengthTable[2] = 0;
                break;
            }

            for (let i = min; i <= max; i++) {
                totalLen[i] = totalLen[i - 1] + countLen[i];
            }

            header.LZSSRepeatCodeLengthTable[0] = min;
            header.LZSSRepeatCodeLengthTable[1] = max;
            header.LZSSRepeatCodeLengthTable[2] = max;

            let totalMin = totalLen[min] * min + (totalLen[max] - totalLen[min]) * max;
            for (let i = min; i < max - 1; i++) {
                if (countLen[i]) {
                    for (let j = i + 1; j < max; j++) {
                        if (countLen[j]) {
                            const total = totalLen[i] * i + (totalLen[j] - totalLen[i]) * j + (totalLen[max] - totalLen[j]) * max;
                            if (total < totalMin) {
                                totalMin = total;
                                header.LZSSRepeatCodeLengthTable[0] = i;
                                header.LZSSRepeatCodeLengthTable[1] = j;
                            }
                        }
                    }
                }
            }

            totalBits += totalMin + totalLen[max] * 3;
        } while (0);

        // 第三段：统计 offset
        do {
            const countLen = new Int32Array(15).fill(0);
            const totalLen = new Int32Array(15).fill(0);

            for (let ptr = 0; ptr < (cbLen >> 1); ) {
                const temp = block[ptr] & 0x7FFF;
                if (block[ptr++] & 0x8000) {
                    for (let i = 0; i < temp; i++) {
                        ptr++; // skip match_len
                        const tmp = block[ptr++];
                        countLen[getBitCount(tmp)]++;
                    }
                }
            }

            let max = 14, min = 1;
            while (max > 0 && !countLen[max]) max--;
            while (min < 15 && !countLen[min]) min++;

            if (max < min) {
                header.LZSSOffsetCodeLengthTable[0] = 0;
                header.LZSSOffsetCodeLengthTable[1] = 0;
                header.LZSSOffsetCodeLengthTable[2] = 0;
                header.LZSSOffsetCodeLengthTable[3] = 0;
                break;
            }

            for (let i = min; i <= max; i++) {
                totalLen[i] = totalLen[i - 1] + countLen[i];
            }

            header.LZSSOffsetCodeLengthTable[0] = min;
            header.LZSSOffsetCodeLengthTable[2] = max;
            header.LZSSOffsetCodeLengthTable[3] = max;

            let idx = min + 1;
            for (; idx < max; idx++) {
                if (countLen[idx]) {
                    header.LZSSOffsetCodeLengthTable[1] = idx;
                    break;
                }
            }

            let totalMin;
            if (idx < max) {
                totalMin = totalLen[min] * min + (totalLen[idx] - totalLen[min]) * idx + (totalLen[max] - totalLen[idx]) * max;
            } else {
                header.LZSSOffsetCodeLengthTable[1] = min;
                totalMin = totalLen[min] * min + (totalLen[max] - totalLen[min]) * max;
            }

            for (let i = min; i < max - 2; i++) {
                if (countLen[i]) {
                    for (let j = i + 1; j < max - 1; j++) {
                        if (countLen[j]) {
                            for (let k = j + 1; k < max; k++) {
                                if (countLen[k]) {
                                    const total = totalLen[i] * i + (totalLen[j] - totalLen[i]) * j +
                                        (totalLen[k] - totalLen[j]) * k + (totalLen[max] - totalLen[k]) * max;
                                    if (total < totalMin) {
                                        totalMin = total;
                                        header.LZSSOffsetCodeLengthTable[0] = i;
                                        header.LZSSOffsetCodeLengthTable[1] = j;
                                        header.LZSSOffsetCodeLengthTable[2] = k;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            totalBits += totalMin + totalLen[max] * 2;
        } while (0);

        return totalBits;
    }

    // Huffman 树节点
    function TreeNode(value, leaf, weight) {
        this.value = value;
        this.leaf = leaf;
        this.level = 0;
        this.weight = weight;
        this.parent = null;
        this.left = null;
        this.right = null;
    }

    // 构建 Huffman 树
    function buildTree(freq) {
        const nodes = [];
        for (let i = 0; i < 0x100; i++) {
            if (freq[i]) {
                nodes.push(new TreeNode(i, true, freq[i]));
            }
        }

        if (nodes.length === 0) return null;

        if (nodes.length === 1) {
            const root = new TreeNode(0, false, nodes[0].weight);
            root.left = nodes[0];
            root.right = new TreeNode((~nodes[0].value) & 0xFF, true, 0);
            root.left.parent = root;
            root.right.parent = root;
            return root;
        }

        nodes.sort((a, b) => a.weight - b.weight);

        while (nodes.length > 1) {
            const left = nodes.shift();
            const right = nodes.shift();
            const parent = new TreeNode(0, false, left.weight + right.weight);
            parent.left = left;
            parent.right = right;
            left.parent = parent;
            right.parent = parent;

            let inserted = false;
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].weight >= parent.weight) {
                    nodes.splice(i, 0, parent);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) nodes.push(parent);
        }

        return nodes[0];
    }

    // 遍历树设置 level 并统计非根节点数
    function traverseTree(root, level, counter) {
        if (!level) {
            counter.value = 0;
        } else {
            counter.value++;
        }
        root.level = level;
        if (root.leaf) return;
        traverseTree(root.left, level + 1, counter);
        traverseTree(root.right, level + 1, counter);
    }

    // 计算 Huffman 编码总位数
    function traverseTreeBits(root, level, freq) {
        if (root.leaf) return level * freq[root.value];
        return traverseTreeBits(root.left, level + 1, freq) + traverseTreeBits(root.right, level + 1, freq);
    }

    // 主压缩函数
    function compress(input) {
        if (!input || input.length === 0) {
            return new Uint8Array(0);
        }

        const src = input;
        const srclen = src.length;
        const blockCount = (srclen & 0x3FFF) ? ((srclen >> 14) + 1) : (srclen >> 14);

        const freq = new Uint32Array(0x100);
        const bfreq = [];
        const block = [];
        const cbLen = new Uint32Array(blockCount);
        const lzLen = new Uint32Array(blockCount);
        const headers = [];

        // 对每个块进行 LZSS 分析
        for (let i = 0; i < blockCount; i++) {
            const baseptr = i << 14;
            const base = src.subarray(baseptr, Math.min(baseptr + BLOCK_SIZE, srclen));
            const blockLen = base.length;

            const bfreqArr = new Uint32Array(0x100);
            bfreq.push(bfreqArr);

            const lzResult = lzAnalysize(base, blockLen, bfreqArr);
            const blockArr = lzResult.result;
            block.push(blockArr);
            cbLen[i] = lzResult.byteLength;

            const header = {
                UncompressedLength: blockLen,
                CompressedLength: 24, // sizeof(YJ_1_BLOCKHEADER)
                LZSSRepeatTable: new Uint16Array(4),
                LZSSOffsetCodeLengthTable: new Uint8Array(4),
                LZSSRepeatCodeLengthTable: new Uint8Array(3),
                CodeCountCodeLengthTable: new Uint8Array(3),
                CodeCountTable: new Uint8Array(2)
            };
            headers.push(header);

            lzLen[i] = cbAnalysize(header, blockArr, cbLen[i]);

            for (let j = 0; j < 0x100; j++) {
                freq[j] += bfreqArr[j];
            }
        }

        // 构建全局 Huffman 树
        const root = buildTree(freq);
        if (!root) {
            throw new Error("Failed to build Huffman tree");
        }

        const treeNodesCounter = { value: 0 };
        traverseTree(root, 0, treeNodesCounter);
        const treeNodes = treeNodesCounter.value;

        // 计算总压缩后大小
        let compressedLength = 16 + treeNodes; // 文件头 + 树节点值区
        if (treeNodes & 0xF) {
            compressedLength += ((treeNodes >> 4) + 1) << 1;
        } else {
            compressedLength += treeNodes >> 3;
        }

        for (let i = 0; i < blockCount; i++) {
            let len = lzLen[i] + traverseTreeBits(root, 0, bfreq[i]);
            len += headers[i].CodeCountCodeLengthTable[0] + 3;
            if (len & 0xF) {
                len = (len >> 4) + 1;
            } else {
                len >>= 4;
            }
            headers[i].CompressedLength += len << 1;
            compressedLength += headers[i].CompressedLength;
        }

        // 分配输出缓冲区（已初始化为 0）
        const output = new Uint8Array(compressedLength);
        const dataView = new DataView(output.buffer);

        // 写文件头
        let offset = 0;
        // Signature 'YJ_1'
        output[offset++] = 0x59; // 'Y'
        output[offset++] = 0x4A; // 'J'
        output[offset++] = 0x5F; // '_'
        output[offset++] = 0x31; // '1'
        dataView.setUint32(offset, srclen, true); offset += 4;
        dataView.setUint32(offset, compressedLength, true); offset += 4;
        dataView.setUint16(offset, blockCount, true); offset += 2;
        output[offset++] = 0xFF; // Unknown
        output[offset++] = treeNodes >> 1; // HuffmanTreeLength

        // 序列化 Huffman 树
        const treeStart = offset;
        const flagStart = offset + treeNodes;
        let dest = treeStart; // 树节点值区写入指针
        let ptr = 0; // 标志位区 bitptr（相对于 flagStart）

        const queue = new Array(0x200);
        let head = 0, tail = 0;
        const leaf = new Array(0x100).fill(null);

        function putIn(v) {
            if (tail < 0x1FF) {
                queue[tail++] = v;
            } else {
                queue[tail = 0] = v;
            }
        }

        function getOut() {
            if (head < 0x1FF) {
                return queue[head++];
            } else {
                return queue[head = 0];
            }
        }

        putIn(root.left);
        putIn(root.right);

        for (let i = 0; i < treeNodes; i++) {
            const node = getOut();
            if (node.leaf) {
                leaf[node.value] = node;
                output[dest++] = node.value;
            } else {
                output[dest++] = tail >> 1;
                putIn(node.left);
                putIn(node.right);
            }
            setBit(output, flagStart, ptr, !node.leaf);
            ptr++;
        }

        // 补零标志位到 16 位边界
        if (ptr & 0xF) {
            const target = ((ptr >> 4) + 1) << 4;
            for (; ptr < target; ptr++) {
                setBit(output, flagStart, ptr, false);
            }
        }

        offset = flagStart + (ptr >> 3);

        // 构建 code 表
        const code = new Array(0x100);
        for (let i = 0; i < 0x100; i++) {
            code[i] = new Uint16Array(0x10);
        }

        for (let i = 0; i < 0x100; i++) {
            if (leaf[i]) {
                let k = 0;
                const hcode = new Uint32Array(8);
                let node = leaf[i];
                while (node.parent) {
                    hcode[k >> 5] <<= 1;
                    if (node === node.parent.right) {
                        hcode[k >> 5] |= 1;
                    }
                    k++;
                    node = node.parent;
                }
                for (k = 0; k < leaf[i].level; k++) {
                    code[i][k >> 4] <<= 1;
                    code[i][k >> 4] |= hcode[k >> 5] & 1;
                    hcode[k >> 5] >>= 1;
                }
            }
        }

        // 编码每个块
        for (let i = 0; i < blockCount; i++) {
            const header = headers[i];
            const bptr = block[i];
            const base = src.subarray(i << 14, Math.min((i << 14) + BLOCK_SIZE, srclen));
            let sptr = 0;
            let bitptr = 0;

            // 写块头
            dataView.setUint16(offset, header.UncompressedLength, true); offset += 2;
            dataView.setUint16(offset, header.CompressedLength, true); offset += 2;
            for (let j = 0; j < 4; j++) {
                dataView.setUint16(offset, header.LZSSRepeatTable[j], true); offset += 2;
            }
            for (let j = 0; j < 4; j++) {
                output[offset++] = header.LZSSOffsetCodeLengthTable[j];
            }
            for (let j = 0; j < 3; j++) {
                output[offset++] = header.LZSSRepeatCodeLengthTable[j];
            }
            for (let j = 0; j < 3; j++) {
                output[offset++] = header.CodeCountCodeLengthTable[j];
            }
            output[offset++] = header.CodeCountTable[0];
            output[offset++] = header.CodeCountTable[1];

            const dst = offset; // 块数据区起始字节偏移

            let idx = 0;
            while (sptr < header.UncompressedLength) {
                let count = bptr[idx] & 0x7FFF;
                bitptr = setLoop(output, dst, bitptr, count, header);
                count = bptr[idx++];
                if (count & 0x8000) {
                    const c = count & 0x7FFF;
                    for (let j = 0; j < c; j++) {
                        const matchLen = bptr[idx++];
                        const pos = bptr[idx++];
                        sptr += matchLen;
                        bitptr = setCount(output, dst, bitptr, matchLen, header);

                        // 编码 offset
                        const cnt = getBitCount(pos);
                        for (let k = 0; k < 4; k++) {
                            if (cnt <= header.LZSSOffsetCodeLengthTable[k]) {
                                bitptr = setBits(output, dst, bitptr, k, 2);
                                bitptr = setBits(output, dst, bitptr, pos, header.LZSSOffsetCodeLengthTable[k]);
                                break;
                            }
                        }
                    }
                } else {
                    for (let j = 0; j < count; j++) {
                        const val = base[sptr++];
                        const node = leaf[val];
                        let maxl = node.level >> 4;
                        if (node.level & 0xF) {
                            bitptr = setBits(output, dst, bitptr, code[val][maxl], node.level & 0xF);
                        }
                        while (maxl--) {
                            bitptr = setBits(output, dst, bitptr, code[val][maxl], 16);
                        }
                    }
                }
            }

            // 写入结束标记
            bitptr = setLoop(output, dst, bitptr, 0, header);

            // 补零到 16 位边界
            if (bitptr & 0xF) {
                bitptr = setBits(output, dst, bitptr, 0, 16 - (bitptr & 0xF));
            }
            bitptr >>= 3;
            offset = dst + bitptr;
        }

        return output;
    }

    return { compress };
})();

// 如果作为模块导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YJ1Compress;
}
