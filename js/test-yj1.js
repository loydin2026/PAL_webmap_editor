const YJ1Compress = require("E:/bak/桌面/palresearch-master/MapEditor/src/web-map-editor/js/yj1-compress.js");

function test() {
    const dataView = (arr, off, len) => {
        let v = 0;
        for (let i = 0; i < len; i++) v |= arr[off + i] << (i * 8);
        return v >>> 0;
    };

    // 测试1：空输入
    const empty = YJ1Compress.compress(new Uint8Array(0));
    console.assert(empty.length === 0, "Empty failed");
    console.log("Empty: OK");

    // 测试2：简单数据
    const simple = new Uint8Array(256);
    for (let i = 0; i < 256; i++) simple[i] = i;
    const c1 = YJ1Compress.compress(simple);
    const sig1 = String.fromCharCode(c1[0], c1[1], c1[2], c1[3]);
    console.assert(sig1 === "YJ_1", "Signature failed: " + sig1);
    console.assert(dataView(c1, 4, 4) === 256, "UncompressedLength failed");
    console.log("Simple 256: OK, compressed to", c1.length, "bytes");

    // 测试3：16KB 块
    const big = new Uint8Array(0x4000);
    for (let i = 0; i < 0x4000; i++) big[i] = i & 0xFF;
    const c2 = YJ1Compress.compress(big);
    console.assert(dataView(c2, 4, 4) === 0x4000, "16K UncompressedLength failed");
    console.assert(dataView(c2, 12, 2) === 1, "16K BlockCount failed: " + dataView(c2, 12, 2));
    console.log("16K: OK, compressed to", c2.length, "bytes");

    // 测试4：多块数据
    const multi = new Uint8Array(0x8001);
    for (let i = 0; i < 0x8001; i++) multi[i] = (i * 7 + 13) & 0xFF;
    const c3 = YJ1Compress.compress(multi);
    console.assert(dataView(c3, 4, 4) === 0x8001, "32K+1 UncompressedLength failed");
    console.assert(dataView(c3, 12, 2) === 3, "32K+1 BlockCount failed: " + dataView(c3, 12, 2));
    console.log("32K+1: OK, compressed to", c3.length, "bytes, blocks:", dataView(c3, 12, 2));

    // 测试5：全零数据（高压缩比）
    const zeros = new Uint8Array(0x4000);
    const c4 = YJ1Compress.compress(zeros);
    console.assert(dataView(c4, 4, 4) === 0x4000, "Zeros UncompressedLength failed");
    console.log("Zeros 16K: OK, compressed to", c4.length, "bytes");

    // 测试6：重复数据
    const repeat = new Uint8Array(0x4000);
    for (let i = 0; i < 0x4000; i++) repeat[i] = (i % 4) + 1;
    const c5 = YJ1Compress.compress(repeat);
    console.assert(dataView(c5, 4, 4) === 0x4000, "Repeat UncompressedLength failed");
    console.log("Repeat 16K: OK, compressed to", c5.length, "bytes");

    console.log("All tests passed.");
}

test();
