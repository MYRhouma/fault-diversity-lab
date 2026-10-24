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
