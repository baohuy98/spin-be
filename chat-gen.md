
export interface ChatMessage {
  id: string
  userId: string
  userName: string
  message: string
  timestamp: number
  roomId: string
}

  // Chat events
      newSocket.on('chat-message', (data: ChatMessage) => {
        console.log('Received chat message:', data)
        setMessages(prev => [...prev, data])
      })

      newSocket.on('chat-history', (data: { messages: ChatMessage[] }) => {
        console.log('Received chat history:', data)
        setMessages(data.messages)
      })