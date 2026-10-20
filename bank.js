const express = require('express');
const app = express();
app.use(express.json());

// Đọc biến môi trường mô phỏng lỗi
const DELAY_MS = parseInt(process.env.DELAY_MS || '0');
const FAIL_RATE = parseFloat(process.env.FAIL_RATE || '0');
const DROP_RATE = parseFloat(process.env.DROP_RATE || '0');

let stats = {
    connections: 0,
    requests: 0,
    charges: 0,
    duplicates: 0
};

// Lưu trữ các giao dịch đã xử lý để đảm bảo không trừ tiền 2 lần
const processedCharges = new Map();

// Theo dõi kết nối TCP mới và đặt timeout kết nối nhàn rỗi là 5 giây
app.use((req, res, next) => {
    stats.connections++;
    console.log(`[BANK] TCP Connection mới #${stats.connections}`);
    
    req.socket.setTimeout(5000);
    req.socket.on('timeout', () => {
        console.log('[BANK] Kết nối nhàn rỗi quá 5 giây, đóng kết nối.');
        req.socket.destroy();
    });
    
    next();
});

// API xử lý trừ tiền
app.post('/charges', (req, res) => {
    stats.requests++;
    const idempotencyKey = req.headers['idempotency-key'] || req.body.reference;
    const { reference, amount } = req.body;

    // 1. Kiểm tra Idempotency (nếu gọi lại cùng mã, trả về kết quả cũ, không trừ tiền nữa)
    if (processedCharges.has(idempotencyKey)) {
        stats.duplicates++;
        console.log(`[BANK] Phát hiện gọi lại trùng lặp cho reference: ${reference}`);
        return res.status(200).json(processedCharges.get(idempotencyKey));
    }

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Số tiền không hợp lệ' });
    }

    // 2. Kiểm tra hạn mức (vượt 20.000.000đ -> từ chối 402)
    if (amount > 20000000) {
        return res.status(402).json({ error: 'Vượt hạn mức giao dịch 20.000.000đ', status: 'FAILED' });
    }

    const executeTransaction = () => {
        // Mô phỏng tỉ lệ lỗi 500 trước khi trừ tiền
        if (Math.random() < FAIL_RATE) {
            return res.status(500).json({ error: 'Lỗi tạm thời từ ngân hàng' });
        }

        // Mô phỏng trừ tiền xong rồi cắt kết nối giữa chừng (DROP_RATE)
        if (Math.random() < DROP_RATE) {
            console.log(`[BANK] Đã trừ tiền nhưng cắt kết nối đột ngột cho reference: ${reference}`);
            processedCharges.set(idempotencyKey, { chargeId: 'ch_' + Date.now(), status: 'PAID', amount });
            stats.charges++;
            return req.socket.destroy();
        }

        // Thành công
        const chargeId = 'ch_' + Date.now();
        const result = { chargeId, amount, status: 'PAID' };
        processedCharges.set(idempotencyKey, result);
        stats.charges++;
        return res.status(201).json(result);
    };

    if (DELAY_MS > 0) {
        setTimeout(executeTransaction, DELAY_MS);
    } else {
        executeTransaction();
    }
});

// API xem thống kê
app.get('/stats', (req, res) => {
    res.json(stats);
});

app.listen(4002, () => {
    console.log(`[BANK] Đang chạy trên cổng 4002 (DELAY=${DELAY_MS}, FAIL=${FAIL_RATE}, DROP=${DROP_RATE})`);
});