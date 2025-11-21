FIREBASE_PROJECT_ID=spin-875a8
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@spin-875a8.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDF3Z3Uvw+MPZC8\nKWj9vinxuodX39Bd0guuBvFCAQbQ7meACL9+I4MMIn6IP2A46e50kTO53I22hXdE\njmk6KX8VeCm4VAHGzhtbFKUrswAQh1wkAI/nxX0wReKBmwfulQiNa3FIXZCCYXze\n9KHSpSXEYu/XzSBsuZu7uLr3lrLhqT9zwv6MGDXFvcU/ZRpAJj5QgUcg4WSllTIL\nDcP+RZBZNQEVrG9GcwdvOHdI2pP+J3OoCnk9DnXZVJ6iQJ8d0eXX8RBsLoXvcBzA\nErdX50wN3mZNftX3iripaOWbjuPqmQxP0rcMG2Q2zWyLUsJckN5lyPK8qvcM8lfD\nmKT3ioCnAgMBAAECggEAV6bdDCm3UYDUZQZTJFThb9wZqKvVOjqaQfWBWqPpyRRT\ndTxq2A4TN4TwWJr6nTvEDo9kQqmZfYmSVCRiKQnI6lHY6XcNcmxLYgW7Rah+FtRf\n1PMKzLmHw6KxvIhY8y/CIiO+gzgvlBJrprjoFtBh8qWBai/MdV2jx30GFjgD9kKk\nEN5rXmYoJEtFAtRsGhmKfPiu85R2AB5nmOfqCUFgU7NYWge2v3CuoApU6QL1ujHU\n5UAU65FqNBwxusvsmH9OSfc5LJQRYXWB0pxXj/Pvh18uK5B4F8onQISK9F2qD+C7\nDfZBYux5QwEbiG1+BEUlLg+/Djj3+WD7O1oGanysQQKBgQDlXHC60KjdYZPHxaAA\nRzvig0SNUpszRpU1R4Ns7ZB3zeaI4nL1bx1ZJwV/v45XN3j+NjeraD8NVQAYBGwx\nXdPNdCWO0qi0BNvKz/To2P1N8W+DVrYb+rPrCL5D27c0l0tGj4sCU/UZSB7fPtHF\nK8Pm3Y4hHzyItwxjneULS5KC2wKBgQDc2LpZNIsm60tGXPnObxh0AtJiFVnuUKQS\nkVF05QLkA/kTsx49UqYL0ML4xs/zuAMwUhsXYBOSgwEFrE/QQmRSk5MLVhurxkJ2\nIBoMdw2NAHBjwEQ2/L+scuvadTPl8n6P8DzZG+qBiYCkNjQKXdmCwWWFzJ/Tr1aR\n6dW6OQb1JQKBgQCwWraW/g+JQRjW9z6CWENUdGhGXajV8USS1ezY2YVGiPvkbnHE\nA27GePmCc3Bn4VBX7qo5UouAncXXsbba8nEDvXWPbqym1kGFnQaL7yQ9RRHgI9Ec\njFTAuFVLaephNp97nq1c2d9QVCLgtrWmbHNR1TMOhq0N1elhwys01yPNFwKBgQDR\n41QvZYV+Ro7y33g2nlUCJJBn0Vz35kIYt21QCDqYE8KL22a45yyR/CTgpKqMOW0m\nZlIDBDd1vfWhu6LbDc4kwMY2Nu7zcOhHNbkr8ZW6VRl7ZAYwsENGFK5cn5jkSHPK\nPorF2Acmd1UAO9d3prwKzdy7rb6UQ4amBDMw2fPn1QKBgC5qDBm5hBRyvuScSID3\nMD7NF6le4NJusNQ6FoEBFLwfszSgDXmAIhuRvmKR4RORfeCdU8bP1/AfNgddkz8u\nGUzXQCxXcop2/0A96p1YdKdOfXQN4MonUJB9Spbhu2KFwHFzGHfbwmrVZzGLrlgx\ndqVIAlNkop2dNGrqAyw8SXmX\n-----END PRIVATE KEY-----\n"



# Hướng dẫn Setup Firebase cho Chat

## Bước 1: Tạo Firebase Project

1. Truy cập [Firebase Console](https://console.firebase.google.com/)
2. Nhấn "Add project" hoặc "Create a project"
3. Nhập tên project (ví dụ: `spin-chat`)
4. Tắt Google Analytics nếu không cần (để đơn giản)
5. Nhấn "Create project"

## Bước 2: Tạo Firestore Database

1. Trong Firebase Console, chọn project vừa tạo
2. Vào menu bên trái, chọn "Firestore Database"
3. Nhấn "Create database"
4. Chọn "Start in test mode" (để đơn giản, sau có thể thay đổi rules)
5. Chọn location (ví dụ: `asia-southeast1` cho Singapore)
6. Nhấn "Enable"

## Bước 3: Tạo Service Account

1. Vào "Project settings" (biểu tượng bánh răng ở menu trái)
2. Chọn tab "Service accounts"
3. Nhấn "Generate new private key"
4. Nhấn "Generate key" để tải file JSON về

## Bước 4: Cấu hình Environment Variables

1. Mở file JSON vừa tải về
2. Tạo file `.env` trong thư mục gốc của project (copy từ `.env.example`)
3. Điền thông tin từ file JSON vào `.env`:

```env
# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"
```

**Lưu ý:**
- `FIREBASE_PROJECT_ID`: lấy từ field `project_id` trong file JSON
- `FIREBASE_CLIENT_EMAIL`: lấy từ field `client_email` trong file JSON
- `FIREBASE_PRIVATE_KEY`: lấy từ field `private_key` trong file JSON (giữ nguyên dấu `\n`)

## Bước 5: Cài đặt dependencies

```bash
npm install firebase-admin
```

## Bước 6: Chạy server

```bash
npm run start:dev
```

## Cấu trúc dữ liệu trong Firestore

Dữ liệu sẽ được lưu theo cấu trúc đơn giản:

```
messages/
  {messageId}/
    - id: string
    - userId: string
    - userName: string
    - message: string
    - timestamp: number
    - roomId: string
```

Lưu ý: Sử dụng cấu trúc flat collection để dễ query và không cần tạo composite index.

## Events đã implement

### 1. `chat-message` (Client -> Server)
Client gửi tin nhắn mới:
```typescript
socket.emit('chat-message', {
  id: 'msg-123',
  userId: 'user-456',
  userName: 'John Doe',
  message: 'Hello everyone!',
  timestamp: Date.now(),
  roomId: 'room-789'
})
```

### 2. `chat-message` (Server -> Client)
Server broadcast tin nhắn đến tất cả members trong room:
```typescript
socket.on('chat-message', (data: ChatMessage) => {
  console.log('New message:', data)
  // Hiển thị tin nhắn
})
```

### 3. `get-chat-history` (Client -> Server)
Client yêu cầu lịch sử chat:
```typescript
socket.emit('get-chat-history', { roomId: 'room-789' })
```

### 4. `chat-history` (Server -> Client)
Server trả về lịch sử chat:
```typescript
socket.on('chat-history', (data: { messages: ChatMessage[] }) => {
  console.log('Chat history:', data.messages)
  // Hiển thị lịch sử
})
```

## Security Rules (Optional - Nâng cao)

Sau khi test xong, bạn nên cập nhật Firestore Rules để bảo mật hơn:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId}/messages/{messageId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

## Troubleshooting

### Lỗi "Failed to save message"
- Kiểm tra lại credentials trong `.env`
- Đảm bảo Firestore đã được enable
- Xem log để biết chi tiết lỗi

### Lỗi "FIREBASE_PRIVATE_KEY không đúng format"
- Đảm bảo giữ nguyên dấu `\n` trong private key
- Đặt toàn bộ private key trong dấu ngoặc kép

### Messages không được lưu
- Kiểm tra Firebase Console > Firestore Database
- Xem log của server để biết có lỗi gì không
