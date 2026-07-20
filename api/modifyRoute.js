export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });

    try {
        const { currentData, command, availableDays } = req.body;
        if (!currentData || !command || !availableDays) {
            return res.status(400).json({ error: 'Thiếu dữ liệu đầu vào để tinh chỉnh tuyến.' });
        }

        const prompt = `Bạn là Trợ lý tinh chỉnh lộ trình. Lộ trình hiện tại: ${JSON.stringify(currentData)}. Yêu cầu quản lý: "${command}". Ngày hợp lệ: ${availableDays.join(', ')}.
        NHIỆM VỤ: Thực hiện đúng yêu cầu điều chỉnh ngày/thứ tự của quản lý. Điểm không bị ảnh hưởng thì giữ nguyên ngày cũ. Sau đó, tự sắp xếp lại "order" từ 1 cho các điểm trong từng ngày sao cho đường đi ngắn nhất. Trả về DUY NHẤT mảng JSON thuần túy, không bọc markdown.
        Cấu trúc JSON bắt buộc: [ { "id": "Mã khách hàng", "day": "Tên ngày", "order": thứ tự bắt đầu từ 1 } ]`;

        // ĐÃ ĐỔI THÀNH SỐ ÍT THEO BIẾN CỦA BẠN
        const keysString = process.env.GEMINI_API_KEY;
        if (!keysString) {
            return res.status(500).json({ error: 'Chưa cấu hình GEMINI_API_KEY trên hệ thống Vercel.' });
        }

        const apiKeys = keysString.split(',').map(key => key.trim()).filter(Boolean);
        let lastErrorData = null; let lastStatus = 500;

        for (let i = 0; i < apiKeys.length; i++) {
            const currentKey = apiKeys[i];
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentKey}`;
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await response.json();

            if (response.ok) {
                let textResponse = data.candidates[0].content.parts[0].text.trim();
                textResponse = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
                return res.status(200).json({ modified_data: JSON.parse(textResponse) });
            }
            lastErrorData = data; lastStatus = response.status;
            if (response.status !== 429) return res.status(response.status).json(data);
        }
        return res.status(lastStatus).json(lastErrorData || { error: 'Tất cả các API key đều lỗi.' });
    } catch (error) {
        return res.status(500).json({ error: 'Lỗi hệ thống nội bộ Server.' });
    }
}
