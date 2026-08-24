// Tính khoảng cách giữa 2 tọa độ (Haversine Formula)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Thuật toán K-Means: Gom khách hàng thành cụm
function kMeansClustering(locations, k, maxIterations = 50) {
    if (locations.length <= k) return { assignments: locations.map((_, i) => i), centroids: locations };
    
    let centroids = locations.slice(0, k).map(l => ({ lat: l.lat, lng: l.lng }));
    let assignments = new Array(locations.length).fill(0);
    let changed = true;
    let iterations = 0;

    while (changed && iterations < maxIterations) {
        changed = false; iterations++;
        for (let i = 0; i < locations.length; i++) {
            let minDist = Infinity; let cluster = 0;
            for (let j = 0; j < k; j++) {
                let dist = getDistance(locations[i].lat, locations[i].lng, centroids[j].lat, centroids[j].lng);
                if (dist < minDist) { minDist = dist; cluster = j; }
            }
            if (assignments[i] !== cluster) { assignments[i] = cluster; changed = true; }
        }
        
        let newCentroids = Array.from({ length: k }, () => ({ lat: 0, lng: 0, count: 0 }));
        for (let i = 0; i < locations.length; i++) {
            let c = assignments[i];
            newCentroids[c].lat += locations[i].lat;
            newCentroids[c].lng += locations[i].lng;
            newCentroids[c].count++;
        }
        for (let j = 0; j < k; j++) {
            if (newCentroids[j].count > 0) {
                centroids[j].lat = newCentroids[j].lat / newCentroids[j].count;
                centroids[j].lng = newCentroids[j].lng / newCentroids[j].count;
            }
        }
    }
    return { assignments, centroids };
}

// THUẬT TOÁN CÂN BẰNG TẢI TRỌNG (Ép tối đa số khách / ngày)
function balanceClusters(locations, assignments, centroids, k, maxCapacity = 30) {
    let counts = new Array(k).fill(0);
    assignments.forEach(c => counts[c]++);

    let overflow = counts.some(c => c > maxCapacity);
    let loopLimit = 2000; // Ngăn lặp vô hạn

    while (overflow && loopLimit > 0) {
        loopLimit--;
        let c_overflow = counts.findIndex(c => c > maxCapacity);
        if (c_overflow === -1) break;

        let bestNodeIdx = -1;
        let bestUnderflowCluster = -1;
        let maxDiff = -Infinity;

        // Tìm khách hàng nằm ở rìa cụm quá tải để chuyển sang cụm còn trống gần nhất
        for (let i = 0; i < locations.length; i++) {
            if (assignments[i] === c_overflow) {
                let distToOwn = getDistance(locations[i].lat, locations[i].lng, centroids[c_overflow].lat, centroids[c_overflow].lng);
                
                let minDistToOther = Infinity;
                let closestOther = -1;
                for(let j = 0; j < k; j++) {
                    if (counts[j] < maxCapacity) {
                        let d = getDistance(locations[i].lat, locations[i].lng, centroids[j].lat, centroids[j].lng);
                        if (d < minDistToOther) {
                            minDistToOther = d;
                            closestOther = j;
                        }
                    }
                }

                if (closestOther !== -1) {
                    let diff = distToOwn - minDistToOther; 
                    if (diff > maxDiff) {
                        maxDiff = diff;
                        bestNodeIdx = i;
                        bestUnderflowCluster = closestOther;
                    }
                }
            }
        }

        if (bestNodeIdx !== -1 && bestUnderflowCluster !== -1) {
            assignments[bestNodeIdx] = bestUnderflowCluster; // Chuyển cụm
            counts[c_overflow]--;
            counts[bestUnderflowCluster]++;
        } else {
            break; // Hết chỗ trống để chứa
        }
        overflow = counts.some(c => c > maxCapacity);
    }
    return assignments;
}

export default async function handler(req, res) {
    // 1. GẮN GIẤY THÔNG HÀNH CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 2. ÉP KIỂU JSON AN TOÀN
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } 
        catch (e) { return res.status(400).json({ error: 'Lỗi parse JSON đầu vào' }); }
    }

    if (body && body.ping) return res.status(200).json({ message: 'Server OK', status: 'ok' });

    try {
        const { locations, availableDays } = body || {};
        
        if (!locations || !Array.isArray(locations) || !availableDays || availableDays.length === 0) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
        }

        // =====================================================================
        // BƯỚC 1: TIỀN XỬ LÝ BẰNG K-MEANS + CÂN BẰNG TẢI TRỌNG TRƯỚC KHI NỐI TUYẾN
        // =====================================================================
        const k = Math.min(availableDays.length, locations.length);
        let { assignments, centroids } = kMeansClustering(locations, k);
        
        // Cưỡng chế tối đa 30 khách/ngày. (Nếu 2 ngày mà có tới 80 khách -> tự nới trần lên 40 để chia đều)
        const maxCapacity = Math.max(30, Math.ceil(locations.length / k));
        assignments = balanceClusters(locations, assignments, centroids, k, maxCapacity);

        let algorithmicData = [];

        // Nối tuyến nội bộ bằng Thuật toán Kẻ láng giềng gần nhất (Nearest Neighbor)
        for (let c = 0; c < k; c++) {
            let clusterLocs = locations.filter((_, idx) => assignments[idx] === c);
            if (clusterLocs.length === 0) continue;

            let targetDay = availableDays[c];
            let unvisited = [...clusterLocs];
            let currentLoc = unvisited.shift();
            let order = 1;

            algorithmicData.push({ id: currentLoc.id, day: targetDay, order: order++, freq: currentLoc.currentFreq || 'F4' });

            while (unvisited.length > 0) {
                let nearestIdx = 0, minDist = Infinity;
                for (let j = 0; j < unvisited.length; j++) {
                    let d = getDistance(currentLoc.lat, currentLoc.lng, unvisited[j].lat, unvisited[j].lng);
                    if (d < minDist) { minDist = d; nearestIdx = j; }
                }
                currentLoc = unvisited.splice(nearestIdx, 1)[0];
                algorithmicData.push({ id: currentLoc.id, day: targetDay, order: order++, freq: currentLoc.currentFreq || 'F4' });
            }
        }

        // =====================================================================
        // BƯỚC 2: GỬI LÊN GEMINI AI ĐỂ TINH CHỈNH
        // =====================================================================
        const keysString = process.env.GEMINI_API_KEY; 
        
        if (!keysString) {
            return res.status(200).json({ message: 'Tối ưu bằng Thuật toán (Chưa có API Key)', optimized_data: algorithmicData });
        }

        const prompt = `Bạn là chuyên gia quy hoạch lộ trình bán hàng (DSD Routing).
Dưới đây là danh sách khách hàng (Tổng số: ${algorithmicData.length} điểm):
${JSON.stringify(algorithmicData)}

Nhiệm vụ của bạn:
1. Sắp xếp lại thứ tự (order) của các điểm giao trong cùng một ngày (day) cho tối ưu quãng đường.
2. TUYỆT ĐỐI KHÔNG ĐƯỢC XÓA, BỎ SÓT HOẶC TỰ Ý BỚT KHÁCH HÀNG NÀO. Mảng trả về BẮT BUỘC PHẢI CÓ ĐÚNG ${algorithmicData.length} PHẦN TỬ.
3. Không thay đổi thuộc tính 'id', 'day', 'freq' của từng phần tử.
4. Số lượng khách trên mỗi tuyến đã được cân bằng (~30 khách/ngày). KHÔNG được tự ý dời khách sang ngày khác.
5. Trả về DUY NHẤT mảng JSON thuần túy: [{"id": "...", "day": "...", "order": ..., "freq": "..."}].`;

        const apiKeys = keysString.split(',').map(key => key.trim()).filter(Boolean);
        let lastErrorData = null;

        for (let i = 0; i < apiKeys.length; i++) {
            const currentKey = apiKeys[i];
            try {
                const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${currentKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { 
                            response_mime_type: "application/json",
                            temperature: 0.1 
                        }
                    })
                });

                const aiData = await aiResponse.json();

                if (aiResponse.ok) {
                    let aiText = aiData.candidates[0].content.parts[0].text;
                    
                    try {
                        aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
                        const finalOptimizedData = JSON.parse(aiText);

                        if (Array.isArray(finalOptimizedData) && finalOptimizedData.length === algorithmicData.length) {
                            return res.status(200).json({
                                message: 'Tối ưu thành công bằng Hybrid AI',
                                optimized_data: finalOptimizedData
                            });
                        } else {
                            console.warn(`[WARNING] AI làm mất khách (${finalOptimizedData.length}/${algorithmicData.length}). Kích hoạt màng lọc Fallback K-Means.`);
                            return res.status(200).json({
                                message: 'Tối ưu bằng Thuật toán (Do AI trả về thiếu số lượng khách)',
                                optimized_data: algorithmicData
                            });
                        }
                    } catch (parseErr) {
                        return res.status(200).json({
                            message: 'Tối ưu bằng Thuật toán (Do AI trả về định dạng lỗi)',
                            optimized_data: algorithmicData
                        });
                    }
                }
                
                const isQuotaError = aiResponse.status === 429 || (aiData.error && aiData.error.status === "RESOURCE_EXHAUSTED");
                if (isQuotaError) { continue; } else { lastErrorData = aiData; break; }

            } catch (e) { lastErrorData = e; break; }
        }

        console.warn("Lỗi Gemini AI toàn diện, tự động chuyển về kết quả thuật toán:", lastErrorData);
        return res.status(200).json({
            message: 'Tối ưu bằng Thuật toán (AI Timeout/Lỗi hệ thống)',
            optimized_data: algorithmicData
        });

    } catch (error) {
        console.error('Lỗi Internal Route:', error);
        return res.status(500).json({ error: 'Lỗi Internal Server Error' });
    }
}
