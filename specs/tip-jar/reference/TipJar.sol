// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITipJar} from "./ITipJar.sol";

/// Reference implementation of the Tip Jar demo specification. It passes the whole demo suite.
contract TipJar is ITipJar {
    uint256 public constant MIN_TIP = 0.001 ether;
    uint256 public constant MAX_NOTE_BYTES = 140;

    address public owner;
    bool public paused;
    uint256 public totalTips;
    uint256 public tipCount;
    mapping(address => uint256) public tipsBy;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    function tip(string calldata note) external payable {
        if (paused) revert JarPaused();
        if (msg.value < MIN_TIP) revert TipTooSmall(msg.value, MIN_TIP);
        if (bytes(note).length > MAX_NOTE_BYTES) revert NoteTooLong(bytes(note).length);
        totalTips += msg.value;
        tipCount += 1;
        tipsBy[msg.sender] += msg.value;
        emit Tipped(msg.sender, msg.value, note);
    }

    function withdraw(uint256 amount) external onlyOwner {
        if (amount > address(this).balance) revert InsufficientBalance(amount, address(this).balance);
        emit Withdrawn(owner, amount);
        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
