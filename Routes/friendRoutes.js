
const express = require('express');
const router = express.Router();
const FriendModel = require('../models/friendModel');
const ensureAuth = require('../Middleware/authMiddleware');

// 1) Send a request
router.post('/friends/request', ensureAuth, async (req, res) => {
  const fromId = req.user.userId;
  const { toUsername } = req.body;
  try {
    await FriendModel.sendFriendRequest(fromId, toUsername);
    // real‑time notify (optional):
    req.io.to(toUsername).emit('friend-request-received', { fromId });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2) List incoming & outgoing
router.get('/friends/requests', ensureAuth, async (req, res) => {
  const userId = req.user.userId;
  const incoming = await FriendModel.getFriendRequests(userId);
  const outgoing = await FriendModel.getPendingRequests(userId);
  res.json({ incoming, outgoing });
});

// 3) Accept
router.post('/friends/request/:fromId/accept', ensureAuth, async (req, res) => {
  const toId = req.user.userId;
  const fromId = req.params.fromId;
  await FriendModel.respondToFriendRequest(fromId, toId, true);
  req.io.to(fromId).emit('friend-request-accepted', { by: toId });
  res.json({ success: true });
});

// 4) Decline
router.post('/friends/request/:fromId/decline', ensureAuth, async (req, res) => {
  const toId = req.user.userId;
  const fromId = req.params.fromId;
  await FriendModel.respondToFriendRequest(fromId, toId, false);
  req.io.to(fromId).emit('friend-request-declined', { by: toId });
  res.json({ success: true });
});

// 5) Remove friend
router.delete('/friends/:friendId', ensureAuth, async (req, res) => {
  const userA = req.user.userId;
  const userB = req.params.friendId;
  await FriendModel.removeFriend(userA, userB);
  req.io.to(userB).emit('friend-removed', { by: userA });
  res.json({ success: true });
});

// 6) Get your friends
router.get('/friends', ensureAuth, async (req, res) => {
  const list = await FriendModel.getFriendsList(req.user.userId);
  res.json(list);
});

module.exports = router;
