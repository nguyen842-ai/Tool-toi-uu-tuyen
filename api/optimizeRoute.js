export default async function handler(req, res) {
    // 1. GẮN GIẤY THÔNG HÀNH CORS (Bắt buộc phải để trên cùng)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // 2. Trả lời trình duyệt khi nó "hỏi dò" (Preflight request)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 3. Chặn các request không phải POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });
    }

    try {
        // [SỬA LỖI 3]: Xử lý Ping từ hàm checkServerStatus() ở Frontend
        if (req.body.ping) {
            return res.status(200).json({ status: 'ok' });
        }

        const { locations, availableDays } = req.body;
        
        if (!locations || locations.length === 0) {
            return res.status(400).json({ error: 'Thiếu dữ liệu vị trí' });
        }

        // Tạo Prompt cho bài toán Phân tuyến theo Tuần
        const prompt = `Bạn là một chuyên gia AI điều phối lộ trình kho vận (Logistics Routing Optimization).
Dưới đây là danh sách khách hàng cần viếng thăm:
${JSON.stringify(locations)}

Danh sách các ngày làm việc cho phép: ${availableDays.join(', ')}

MỤC TIÊU: Gom cụm địa lý, cân bằng tải và tối ưu TSP (Traveling Salesperson Problem).

CÁC QUY TẮC RÀNG BUỘC (TUYỆT ĐỐI TUÂN THỦ):
1. Giới hạn năng lực: Mỗi tuyến đường (1 ngày đi 1 vòng) KHÔNG ĐƯỢC VƯỢT QUÁ 40 khách hàng.
2. Cơ chế tách tuyến (Phân tần suất): 
   - Nếu số lượng khách hàng gửi vào lớn hơn 40 khách, BẮT BUỘC phải chia đôi tập khách hàng này thành 2 nhóm đi luân phiên:
     + Nhóm 1: Gán trường "freq" là "F2-1" (Đi tuần 1 & 3).
     + Nhóm 2: Gán trường "freq" là "F2-2" (Đi tuần 2 & 4).
   - Đảm bảo 2 nhóm này đan xen nhau trên tuyến đường để tránh chạy rỗng.
   - Nếu số lượng khách hàng <= 40, gán trường "freq" là "F4" (Đi mỗi tuần).
3. Phân bổ ngày làm việc: Nếu availableDays có nhiều hơn 1 ngày, hãy chia đều số lượng khách vào các ngày dựa theo cụm địa lý gần nhau.
4. Sắp xếp thứ tự: Trong cùng một ngày (day) và cùng một tần suất (freq), sắp xếp trường "order" từ 1 đến N sao cho tổng quãng đường di chuyển là ngắn nhất.

ĐỊNH DẠNG ĐẦU RA BẮT BUỘC:
Trả về DUY NHẤT một mảng JSON thuần túy, tuyệt đối không bọc trong markdown \`\`\`json, không giải thích thêm.
Cấu trúc mảng phải chính xác như sau:
[
  { "id": "Mã KH", "day": "Thứ 2", "order": 1, "freq": "F4" },
  { "id": "Mã KH", "day": "Thứ 2", "order": 2, "freq": "F4" }
]`; // [SỬA LỖI 1]: Đã thêm dấu đóng backtick (`) và dấu chấm phẩy ở đây

        // Lấy danh sách chìa khóa
        const keysString = process.env.GEMINI_API_KEY; 
        if (!keysString) {
            return res.status(500).json({ error: 'Chưa cài đặt Keys trên Server' });
        }

        const apiKeys = keysString.split(',').map(key => key.trim()).filter(key => key.length > 0);
        let lastErrorData = null;
        let lastStatus = 500;

        // Xoay vòng chìa khóa
        for (let i = 0; i < apiKeys.length; i++) {
            const currentKey = apiKeys[i];
            
            // [SỬA LỖI 2]: Gọi đúng Model Gemini 1.5 Flash
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${currentKey}`;
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const data = await response.json();
            
            if (response.ok) {
                // Làm sạch JSON rác từ AI trước khi parse
                let textResponse = data.candidates[0].content.parts[0].text.trim();
                textResponse = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
                
                const optimizedData = JSON.parse(textResponse);
                return res.status(200).json({ optimized_data: optimizedData });
            } 
            
            lastErrorData = data;
            lastStatus = response.status;
            
            const isQuotaError = response.status === 429 || (data.error && data.error.status === "RESOURCE_EXHAUSTED");
            if (isQuotaError) {
                console.log(`Key ${i+1} hết hạn mức, thử key tiếp theo...`);
                continue; 
            } else {
                return res.status(response.status).json(data);
            }
        }

        return res.status(lastStatus).json(lastErrorData || { error: 'Tất cả các key đều đã cạn kiệt.' });

    } catch (error) {
        console.error("Lỗi Server:", error);
        return res.status(500).json({ error: 'Lỗi hệ thống nội bộ Server' });
    }
}
