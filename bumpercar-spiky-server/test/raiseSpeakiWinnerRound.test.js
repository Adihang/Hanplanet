const assert = require("node:assert/strict")
const test = require("node:test")

const accountStats = require("../services/accountStats")
const recordedStatsUpdates = []
accountStats.postStatsUpdate = (...args) => {
    recordedStatsUpdates.push(args)
}

const RaiseSpeakiWorld = require("../world/raiseSpeakiWorld")

function findDummy(world) {
    return Array.from(world.players.values()).find((player) => player.isDummy)
}

test("Raise Speaki locks a level-10 winner, freezes the round, and resets after the result countdown", () => {
    recordedStatsUpdates.length = 0
    const world = new RaiseSpeakiWorld()
    const neutralPumpkins = Array.from(world.players.values()).filter((player) => player.isNeutralPumpkinNpc)
    assert.equal(neutralPumpkins.length, 4)
    const winner = world.addPlayer("winner-connection", "winner", { skinName: "default" })
    const otherPlayer = world.addPlayer("other-connection", "other", { skinName: "default" })
    world.applyRaiseSpeakiLevel(winner, 10)
    world.update()
    const countdownStartedAt = world.raiseSpeakiWinnerCountdownUntil - 10_000

    assert.equal(world.raiseSpeakiWinnerPhase, "countdown")
    assert.equal(world.raiseSpeakiWinner.displayName, "winner")
    assert.equal(world.getRaiseSpeakiWinnerCountdownSeconds(countdownStartedAt), 10)

    winner.currentSpeed = 300
    winner.lastMoveX = 12
    otherPlayer.currentSpeed = 300
    otherPlayer.lastMoveY = 12
    const dummy = findDummy(world)
    dummy.currentSpeed = 300
    dummy.lastMoveX = 12

    world.advanceRaiseSpeakiWinnerRound(world.raiseSpeakiWinnerCountdownUntil)

    assert.equal(world.raiseSpeakiWinnerPhase, "result")
    assert.deepEqual(recordedStatsUpdates, [["winner", { raise_speaki_wins: 1 }]])
    world.advanceRaiseSpeakiWinnerRound(world.raiseSpeakiWinnerRestartUntil - 1)
    assert.equal(recordedStatsUpdates.length, 1)
    assert.equal(world.getRaiseSpeakiWinnerCountdownSeconds(world.raiseSpeakiWinnerRestartUntil - 5_000), 5)
    for (const player of world.players.values()) {
        assert.equal(player.currentSpeed, 0)
        assert.equal(player.lastMoveX, 0)
        assert.equal(player.lastMoveY, 0)
        assert.equal(player.boostState, "idle")
    }

    world.raiseSpeakiLevelDrops.push({ id: "temporary-drop" })
    world.playerProgress.set("disconnected-level-ten", { level: 10 })
    world.advanceRaiseSpeakiWinnerRound(world.raiseSpeakiWinnerRestartUntil)

    assert.equal(world.raiseSpeakiWinnerPhase, "")
    assert.equal(world.raiseSpeakiWinner, null)
    assert.equal(world.raiseSpeakiLevelDrops.length, 0)
    assert.equal(world.getStoredPlayerProgress("disconnected-level-ten"), null)
    assert.equal(winner.level, 1)
    assert.equal(otherPlayer.level, 1)
})

test("Raise Speaki NPC victories do not award an account skin-unlock stat", () => {
    recordedStatsUpdates.length = 0
    const world = new RaiseSpeakiWorld()
    const npcWinner = findDummy(world)
    world.applyRaiseSpeakiLevel(npcWinner, 10)
    world.update()

    world.advanceRaiseSpeakiWinnerRound(world.raiseSpeakiWinnerCountdownUntil)

    assert.equal(world.raiseSpeakiWinnerPhase, "result")
    assert.equal(recordedStatsUpdates.length, 0)
})

test("Raise Speaki AI target weights increase with target level and decrease with distance", () => {
    const world = new RaiseSpeakiWorld()
    const npc = findDummy(world)
    const nearLowLevel = world.addPlayer("near-low", "near-low", { skinName: "default" })
    const farLowLevel = world.addPlayer("far-low", "far-low", { skinName: "default" })
    const nearHighLevel = world.addPlayer("near-high", "near-high", { skinName: "default" })

    npc.x = 500
    npc.y = 500
    nearLowLevel.x = 550
    nearLowLevel.y = 500
    farLowLevel.x = 1_500
    farLowLevel.y = 500
    nearHighLevel.x = 550
    nearHighLevel.y = 500
    world.applyRaiseSpeakiLevel(nearHighLevel, 5)

    const nearLowWeight = world.getRaiseSpeakiDummyTargetWeight(npc, nearLowLevel)
    const farLowWeight = world.getRaiseSpeakiDummyTargetWeight(npc, farLowLevel)
    const nearHighWeight = world.getRaiseSpeakiDummyTargetWeight(npc, nearHighLevel)

    assert.ok(nearLowWeight > farLowWeight)
    assert.ok(nearHighWeight > nearLowWeight)

    const originalRandom = Math.random
    Math.random = () => 0
    try {
        const selected = world.chooseRaiseSpeakiDummyTarget(npc, { excludeTargetId: nearLowLevel.id })
        assert.notEqual(selected.id, nearLowLevel.id)
    } finally {
        Math.random = originalRandom
    }

    world.retargetRaiseSpeakiDummyAfterDashHit(npc, nearHighLevel)
    assert.notEqual(npc.dummyRetaliationTargetId, nearHighLevel.id)
})

test("Raise Speaki AI prioritizes the closest pumpkin when no other target is closer, including player-owned pumpkins", () => {
    const world = new RaiseSpeakiWorld()
    const npc = findDummy(world)
    npc.skinName = "default"
    npc.initialSkinName = "default"
    npc.isPumpkinSkin = false
    world.players = new Map([[npc.id, npc]])

    const owner = world.addPlayer("pumpkin-owner", "pumpkin-owner", { skinName: "default" })
    const ownedPumpkin = world.spawnPumpkinNpc({ x: 650, y: 500 }, owner)
    const fartherPlayer = world.addPlayer("farther-player", "farther-player", { skinName: "default" })
    const closerPlayer = world.addPlayer("closer-player", "closer-player", { skinName: "default" })
    npc.x = 500
    npc.y = 500
    owner.x = 1_500
    owner.y = 500
    fartherPlayer.x = 900
    fartherPlayer.y = 500

    const pumpkinPriorityTarget = world.chooseRaiseSpeakiDummyTarget(npc)
    assert.equal(ownedPumpkin.isNeutralPumpkinNpc, false)
    assert.equal(pumpkinPriorityTarget.id, ownedPumpkin.id)

    closerPlayer.x = 575
    closerPlayer.y = 500
    const originalRandom = Math.random
    Math.random = () => 0.1
    try {
        const fallbackWeightedTarget = world.chooseRaiseSpeakiDummyTarget(npc)
        assert.equal(fallbackWeightedTarget.id, fartherPlayer.id)
        assert.notEqual(fallbackWeightedTarget.id, ownedPumpkin.id)
    } finally {
        Math.random = originalRandom
    }
})
