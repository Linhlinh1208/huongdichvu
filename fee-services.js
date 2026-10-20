const express = require('express');
const axios = require('axios');
const http = require('http');

const app = express();
app.use(express.json());

// Tối ưu kết nối TCP Keep-Alive cho Tình huống 3
const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 50,
    timeout: 5000
});

// Dữ liệu sinh viên trong bộ nhớ
let students = {
    1: { id: 1, name: 'Sinh viên 1', debt: 50000000 },
    2: { id: 2, name: 'Sinh viên 2', debt: 0 },
    3: { id: 3, name: 'Sinh viên 3', debt: 3200000 }
};

// API tra cứu công nợ (luôn phản hồi nhanh)
app.get('/students/:id/fees', (req, res) => {
    const student = students[req.params.id];
    if (!student) return res.status(404).json({ error: 'Không tìm thấy sinh viên' });
    res.json(student);
});

// API thực hiện thanh toán học phí
app.post('/students/:id/payments', async (req, res) => {
    const studentId = req.params.id;
    const { amount } = req.body;
    const student = students[studentId];

    if (!student) return res.status(404).json({ error: 'Không tìm thấy sinh viên' });
    if (amount > student.debt) {
        return res.status(400).json({ error: 'Số tiền thanh toán vượt quá công nợ' });
    }

    const reference = `PAY-${studentId}-${Date.now()}`;
    const bankUrl = process.env.BANK_URL || 'http://localhost:4002';

    try {
        // Gọi sang ngân hàng với timeout 4.5 giây
        const response = await axios.post(`${bankUrl}/charges`, {
            reference,
            amount
        }, {
            headers: { 'Idempotency-Key': reference },
            timeout: 4500,
            httpAgent
        });

        if (response.status === 201 && response.data.status === 'PAID') {
            student.debt -= amount; // Trừ công nợ khi ngân hàng xác nhận thành công
            return res.status(201).json({ paymentId: reference, status: 'PAID', message: 'Thanh toán thành công' });
        }
    } catch (error) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return res.status(503).json({ error: 'Không kết nối được tới ngân hàng', paymentId: reference, status: 'FAILED' });
        }
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return res.status(504).json({ error: 'Hết thời gian chờ từ ngân hàng', paymentId: reference, status: 'PENDING' });
        }
        if (error.response) {
            const status = error.response.status;
            if (status === 402) {
                return res.status(402).json({ error: error.response.data.error, paymentId: reference, status: 'FAILED' });
            }
            if (status === 500) {
                return res.status(503).json({ error: 'Ngân hàng đang lỗi tạm thời', paymentId: reference, status: 'PENDING' });
            }
            return res.status(status).json({ error: error.response.data.error, paymentId: reference, status: 'FAILED' });
        }
        return res.status(504).json({ error: 'Mất kết nối đột ngột', paymentId: reference, status: 'PENDING' });
    }
});

app.listen(4001, () => {
    console.log('[FEE SERVICE] Đang chạy trên cổng 4001');
});