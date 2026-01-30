const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

// 创建Express应用
const app = express();
app.use(cors());

// 创建HTTP服务器
const server = http.createServer(app);

// 创建Socket.IO实例
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 房间管理
const rooms = new Map();

// 生成6位房间号
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 生成唯一用户ID
function generateUserId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// 根据玩家数量生成角色配置
function generateRoles(playerCount) {
  const roles = [];
  
  // 根据人数确定角色数量
  let wolfCount = 2;
  let seerCount = 1;
  let witchCount = 1;
  let hunterCount = 1;
  let guardCount = 0;
  let villagerCount = playerCount - wolfCount - seerCount - witchCount - hunterCount - guardCount;
  
  if (playerCount >= 9) {
    wolfCount = 3;
    guardCount = 1;
    villagerCount = playerCount - wolfCount - seerCount - witchCount - hunterCount - guardCount;
  }
  
  if (playerCount >= 12) {
    wolfCount = 4;
    villagerCount = playerCount - wolfCount - seerCount - witchCount - hunterCount - guardCount;
  }
  
  // 添加角色
  for (let i = 0; i < wolfCount; i++) roles.push('wolf');
  for (let i = 0; i < seerCount; i++) roles.push('seer');
  for (let i = 0; i < witchCount; i++) roles.push('witch');
  for (let i = 0; i < hunterCount; i++) roles.push('hunter');
  for (let i = 0; i < guardCount; i++) roles.push('guard');
  for (let i = 0; i < villagerCount; i++) roles.push('villager');
  
  // 随机打乱角色
  return shuffleArray(roles);
}

// 随机打乱数组
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// WebSocket连接处理
io.on('connection', (socket) => {
  console.log(`用户 ${socket.id} 已连接`);
  
  // 用户信息
  let userInfo = {
    id: socket.id,
    name: `玩家${Math.floor(Math.random() * 1000)}`,
    isHost: false,
    isReady: false,
    role: null,
    isAlive: true
  };
  
  // 创建房间
  socket.on('create_room', (data) => {
    const { name, password, playerCount } = data;
    const roomId = generateRoomId();
    
    // 创建房间对象
    const room = {
      id: roomId,
      name: name || '未命名房间',
      password: password || null,
      playerCount: playerCount || 6,
      players: [userInfo],
      roles: generateRoles(playerCount || 6),
      isGameStarted: false,
      isGameOver: false,
      currentPhase: 'night',
      dayCount: 1,
      phaseTimer: null,
      gameState: {
        phase: 'night',
        dayCount: 1,
        currentAction: 'wolf',
        votes: {},
        lastGuard: null,
        witchHealUsed: false,
        witchPoisonUsed: false,
        seerChecked: null,
        wolfKilled: null
      }
    };
    
    // 设置用户为房主
    userInfo.isHost = true;
    userInfo.isReady = true;
    
    // 保存房间
    rooms.set(roomId, room);
    
    // 加入房间
    socket.join(roomId);
    
    // 返回房间信息
    socket.emit('create_room_success', {
      room,
      user: userInfo
    });
    
    console.log(`房间 ${roomId} 已创建，房主: ${userInfo.name}`);
  });
  
  // 加入房间
  socket.on('join_room', (data) => {
    const { roomId, password, username } = data;
    const room = rooms.get(roomId);
    
    // 检查房间是否存在
    if (!room) {
      socket.emit('join_room_error', { message: '房间不存在' });
      return;
    }
    
    // 检查房间密码
    if (room.password && room.password !== password) {
      socket.emit('join_room_error', { message: '密码错误' });
      return;
    }
    
    // 检查房间是否已满
    if (room.players.length >= room.playerCount) {
      socket.emit('join_room_error', { message: '房间已满' });
      return;
    }
    
    // 检查房间是否已开始游戏
    if (room.isGameStarted) {
      socket.emit('join_room_error', { message: '游戏已开始' });
      return;
    }
    
    // 更新用户信息
    if (username) {
      userInfo.name = username;
    }
    
    // 添加用户到房间
    room.players.push(userInfo);
    
    // 加入房间
    socket.join(roomId);
    
    // 返回房间信息
    socket.emit('join_room_success', {
      room,
      user: userInfo
    });
    
    // 通知房间内其他玩家
    socket.to(roomId).emit('player_joined', {
      player: userInfo,
      room: room
    });
    
    console.log(`用户 ${userInfo.name} 加入房间 ${roomId}`);
  });
  
  // 离开房间
  socket.on('leave_room', (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    // 查找用户索引
    const userIndex = room.players.findIndex(p => p.id === userInfo.id);
    
    if (userIndex !== -1) {
      // 如果是房主，转让房主身份
      if (room.players[userIndex].isHost) {
        if (room.players.length > 1) {
          room.players[1].isHost = true;
        }
      }
      
      // 移除用户
      room.players.splice(userIndex, 1);
      
      // 如果房间为空，删除房间
      if (room.players.length === 0) {
        rooms.delete(roomId);
        console.log(`房间 ${roomId} 已删除`);
      } else {
        // 通知房间内其他玩家
        socket.to(roomId).emit('player_left', {
          player: userInfo,
          room: room
        });
        
        console.log(`用户 ${userInfo.name} 离开房间 ${roomId}`);
      }
    }
    
    // 离开房间
    socket.leave(roomId);
  });
  
  // 准备/取消准备
  socket.on('toggle_ready', (data) => {
    const { roomId, isReady } = data;
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    // 查找用户
    const user = room.players.find(p => p.id === userInfo.id);
    
    if (user) {
      user.isReady = isReady;
      
      // 通知房间内所有玩家
      io.to(roomId).emit('player_ready_changed', {
        playerId: user.id,
        isReady: isReady,
        room: room
      });
    }
  });
  
  // 开始游戏
  socket.on('start_game', (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    // 检查是否是房主
    const user = room.players.find(p => p.id === userInfo.id);
    if (!user || !user.isHost) {
      socket.emit('start_game_error', { message: '只有房主可以开始游戏' });
      return;
    }
    
    // 检查玩家数量
    if (room.players.length < 6) {
      socket.emit('start_game_error', { message: '至少需要6名玩家' });
      return;
    }
    
    // 检查准备状态
    const readyPlayers = room.players.filter(p => p.isReady || p.isHost);
    if (readyPlayers.length < room.players.length) {
      socket.emit('start_game_error', { message: '还有玩家未准备' });
      return;
    }
    
    // 开始游戏
    room.isGameStarted = true;
    
    // 分配角色
    const roles = generateRoles(room.playerCount);
    room.players.forEach((player, index) => {
      player.role = roles[index];
      player.isAlive = true;
    });
    
    // 初始化游戏状态
    room.gameState = {
      phase: 'night',
      dayCount: 1,
      currentAction: 'wolf',
      votes: {},
      lastGuard: null,
      witchHealUsed: false,
      witchPoisonUsed: false,
      seerChecked: null,
      wolfKilled: null
    };
    
    // 通知房间内所有玩家
    io.to(roomId).emit('game_started', {
      room: room
    });
    
    console.log(`房间 ${roomId} 游戏已开始`);
  });
  
  // 玩家行动
  socket.on('game_action', (data) => {
    const { roomId, actionType, targetId } = data;
    const room = rooms.get(roomId);
    
    if (!room || !room.isGameStarted) return;
    
    // 查找当前玩家
    const currentPlayer = room.players.find(p => p.id === userInfo.id);
    
    if (!currentPlayer || !currentPlayer.isAlive) return;
    
    let message = '';
    
    // 处理不同类型的行动
    switch (actionType) {
      case 'wolfKill':
        // 狼人击杀
        if (currentPlayer.role === 'wolf' && room.gameState.currentAction === 'wolf') {
          room.gameState.wolfKilled = targetId;
          message = `狼人选择击杀了${getPlayerName(room.players, targetId)}`;
          room.gameState.currentAction = 'seer';
        }
        break;
        
      case 'seerCheck':
        // 预言家查验
        if (currentPlayer.role === 'seer' && room.gameState.currentAction === 'seer') {
          room.gameState.seerChecked = targetId;
          const targetPlayer = room.players.find(p => p.id === targetId);
          const isWolf = targetPlayer.role === 'wolf';
          message = `预言家查验了${targetPlayer.name}`;
          
          // 只对预言家发送查验结果
          socket.emit('seer_check_result', {
            target: targetPlayer.name,
            isWolf: isWolf
          });
          
          room.gameState.currentAction = 'witch';
        }
        break;
        
      case 'witchHeal':
        // 女巫治疗
        if (currentPlayer.role === 'witch' && room.gameState.currentAction === 'witch' && !room.gameState.witchHealUsed) {
          room.gameState.witchHealUsed = true;
          room.gameState.wolfKilled = null;
          message = '女巫使用解药救了被狼人击杀的玩家';
        }
        break;
        
      case 'witchPoison':
        // 女巫毒杀
        if (currentPlayer.role === 'witch' && room.gameState.currentAction === 'witch' && !room.gameState.witchPoisonUsed) {
          room.gameState.witchPoisonUsed = true;
          
          // 标记目标为死亡
          const targetPlayer = room.players.find(p => p.id === targetId);
          if (targetPlayer) {
            targetPlayer.isAlive = false;
            message = `女巫使用毒药毒死了${targetPlayer.name}`;
          }
        }
        break;
        
      case 'guardProtect':
        // 守卫守护
        if (currentPlayer.role === 'guard' && room.gameState.currentAction === 'guard') {
          room.gameState.lastGuard = targetId;
          message = `守卫守护了${getPlayerName(room.players, targetId)}`;
          
          // 夜晚结束，进入白天
          endNight(room);
        }
        break;
        
      case 'vote':
        // 投票
        if (room.gameState.phase === 'vote') {
          room.gameState.votes[currentPlayer.id] = targetId;
          message = `${currentPlayer.name}投票给了${getPlayerName(room.players, targetId)}`;
          
          // 检查是否所有玩家都已投票
          const alivePlayers = room.players.filter(p => p.isAlive);
          if (Object.keys(room.gameState.votes).length === alivePlayers.length) {
            processVotes(room);
          }
        }
        break;
    }
    
    // 如果有消息，广播给房间内所有玩家
    if (message) {
      io.to(roomId).emit('game_message', {
        message: message,
        timestamp: new Date()
      });
    }
    
    // 更新游戏状态
    io.to(roomId).emit('game_state_updated', {
      room: room
    });
    
    // 检查游戏是否结束
    checkGameOver(room, roomId);
  });
  
  // 聊天消息
  socket.on('chat_message', (data) => {
    const { roomId, message } = data;
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    // 广播聊天消息
    io.to(roomId).emit('chat_message', {
      userId: userInfo.id,
      userName: userInfo.name,
      message: message,
      timestamp: new Date()
    });
  });
  
  // 断开连接
  socket.on('disconnect', () => {
    console.log(`用户 ${userInfo.name} 已断开连接`);
    
    // 查找用户所在的房间
    for (const [roomId, room] of rooms.entries()) {
      const userIndex = room.players.findIndex(p => p.id === userInfo.id);
      
      if (userIndex !== -1) {
        // 如果是房主，转让房主身份
        if (room.players[userIndex].isHost) {
          if (room.players.length > 1) {
            room.players[1].isHost = true;
          }
        }
        
        // 移除用户
        room.players.splice(userIndex, 1);
        
        // 如果房间为空，删除房间
        if (room.players.length === 0) {
          rooms.delete(roomId);
          console.log(`房间 ${roomId} 已删除`);
        } else {
          // 通知房间内其他玩家
          socket.to(roomId).emit('player_disconnected', {
            player: userInfo,
            room: room
          });
          
          console.log(`用户 ${userInfo.name} 断开连接，离开房间 ${roomId}`);
        }
        
        break;
      }
    }
  });
});

// 获取玩家名称
function getPlayerName(players, playerId) {
  const player = players.find(p => p.id === playerId);
  return player ? player.name : '未知玩家';
}

// 结束夜晚
function endNight(room) {
  // 处理夜晚结果
  if (room.gameState.wolfKilled) {
    // 检查目标是否被守卫守护
    if (room.gameState.wolfKilled !== room.gameState.lastGuard) {
      // 标记目标为死亡
      const targetPlayer = room.players.find(p => p.id === room.gameState.wolfKilled);
      if (targetPlayer) {
        targetPlayer.isAlive = false;
        
        // 检查猎人是否被击杀
        if (targetPlayer.role === 'hunter') {
          // 猎人可以开枪，但这里简化处理
          // 实际实现中应该让猎人选择开枪目标
        }
      }
    }
  }
  
  // 进入白天
  room.gameState.phase = 'day';
  room.gameState.currentAction = null;
}

// 处理投票
function processVotes(room) {
  // 统计投票
  const voteCounts = {};
  Object.values(room.gameState.votes).forEach(votedId => {
    voteCounts[votedId] = (voteCounts[votedId] || 0) + 1;
  });
  
  // 找出得票最多的玩家
  let maxVotes = 0;
  let maxVotedPlayers = [];
  
  Object.entries(voteCounts).forEach(([playerId, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      maxVotedPlayers = [playerId];
    } else if (count === maxVotes) {
      maxVotedPlayers.push(playerId);
    }
  });
  
  // 如果有平票，随机选择一名玩家
  if (maxVotedPlayers.length > 1) {
    shuffleArray(maxVotedPlayers);
  }
  
  const votedPlayerId = maxVotedPlayers[0];
  
  // 如果有玩家被投票放逐
  if (votedPlayerId) {
    const votedPlayer = room.players.find(p => p.id === votedPlayerId);
    
    if (votedPlayer) {
      // 标记玩家为死亡
      votedPlayer.isAlive = false;
      
      // 检查猎人是否被放逐
      if (votedPlayer.role === 'hunter') {
        // 猎人可以开枪，但这里简化处理
        // 实际实现中应该让猎人选择开枪目标
      }
    }
  }
  
  // 进入下一个夜晚
  room.gameState.phase = 'night';
  room.gameState.dayCount++;
  room.gameState.currentAction = 'wolf';
  room.gameState.votes = {};
}

// 检查游戏是否结束
function checkGameOver(room, roomId) {
  // 检查狼人是否全部死亡
  const aliveWolves = room.players.filter(p => p.isAlive && p.role === 'wolf');
  if (aliveWolves.length === 0) {
    // 好人胜利
    room.isGameOver = true;
    io.to(roomId).emit('game_over', {
      winner: '好人',
      room: room
    });
    return true;
  }
  
  // 检查好人是否全部死亡
  const aliveGood = room.players.filter(p => p.isAlive && p.role !== 'wolf');
  if (aliveGood.length === 0) {
    // 狼人胜利
    room.isGameOver = true;
    io.to(roomId).emit('game_over', {
      winner: '狼人',
      room: room
    });
    return true;
  }
  
  // 检查神职是否全部死亡
  const aliveClergy = room.players.filter(p => p.isAlive && ['seer', 'witch', 'hunter', 'guard'].includes(p.role));
  const aliveVillagers = room.players.filter(p => p.isAlive && p.role === 'villager');
  
  // 如果只剩下狼人和村民，且狼人数量大于等于村民数量
  if (aliveClergy.length === 0 && aliveWolves.length >= aliveVillagers.length) {
    // 狼人胜利
    room.isGameOver = true;
    io.to(roomId).emit('game_over', {
      winner: '狼人',
      room: room
    });
    return true;
  }
  
  return false;
}

// 静态文件服务
app.use(express.static('../'));

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});