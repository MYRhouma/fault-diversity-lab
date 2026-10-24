=== SYSTEM ===
You are an experienced Solidity developer. You write one complete, compilable source file that implements the
specification exactly. Answer with the file only, in a single fenced code block, without explanations.

=== USER ===
Implement the Tip Jar contract described below.

Specification
-------------
A Tip Jar collects tips in ether for its owner.

1. The account that deploys the contract is the owner. The jar starts unpaused, with no tips.
2. tip(note) accepts a tip of msg.value wei with a short note.
   - It reverts with JarPaused() while the jar is paused.
   - It reverts with TipTooSmall(sent, minimum) if msg.value is below MIN_TIP = 0.001 ether.
   - It reverts with NoteTooLong(length) if the note is longer than MAX_NOTE_BYTES = 140 bytes.
   - Otherwise it adds msg.value to totalTips and to tipsBy(msg.sender), adds 1 to tipCount and emits
     Tipped(msg.sender, msg.value, note).
3. withdraw(amount) sends amount wei to the owner and emits Withdrawn(owner, amount).
   - Only the owner may call it, else it reverts with NotOwner(caller).
   - It reverts with InsufficientBalance(requested, available) if amount is above the contract's balance.
   - It reverts with TransferFailed() if the transfer fails. Withdrawing does not change totalTips.
4. setPaused(paused) sets the paused flag and emits PausedSet(paused). Only the owner may call it.
5. transferOwnership(newOwner) makes newOwner the owner and emits OwnershipTransferred(previous, newOwner).
   Only the owner may call it; it reverts with ZeroAddress() if newOwner is the zero address.
6. The checks of each function run in the order they are listed above.

Interface
---------
The contract must be named TipJar, implement ITipJar and import it with:
    import {ITipJar} from "./ITipJar.sol";
Do not repeat the interface in your file. ITipJar.sol is:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The interface every Tip Jar variant implements. It is sent to the model as part of the prompt.
interface ITipJar {
    error TipTooSmall(uint256 sent, uint256 minimum);
    error NoteTooLong(uint256 length);
    error JarPaused();
    error NotOwner(address caller);
    error InsufficientBalance(uint256 requested, uint256 available);
    error ZeroAddress();
    error TransferFailed();

    event Tipped(address indexed from, uint256 amount, string note);
    event Withdrawn(address indexed to, uint256 amount);
    event PausedSet(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function MIN_TIP() external view returns (uint256);
    function MAX_NOTE_BYTES() external view returns (uint256);

    function tip(string calldata note) external payable;
    function withdraw(uint256 amount) external;
    function setPaused(bool paused_) external;
    function transferOwnership(address newOwner) external;

    function owner() external view returns (address);
    function paused() external view returns (bool);
    function totalTips() external view returns (uint256);
    function tipCount() external view returns (uint256);
    function tipsBy(address account) external view returns (uint256);
}
```

Output file: TipJar.sol
