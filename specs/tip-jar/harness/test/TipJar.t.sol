// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ITipJar} from "../src/ITipJar.sol";
import {TipJar} from "../src/TipJar.sol";

/// Shared setup: the test contract deploys the jar, so it is the owner. Two tippers have 10 ether each.
abstract contract TipJarBase is Test {
    ITipJar internal jar;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public virtual {
        jar = ITipJar(address(new TipJar()));
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    receive() external payable {}
}

/// Tipping: the rules of tip(), the counters and the event.
contract TipTest is TipJarBase {
    function test_constants() public view {
        assertEq(jar.MIN_TIP(), 0.001 ether);
        assertEq(jar.MAX_NOTE_BYTES(), 140);
    }

    function test_tipUpdatesCounters() public {
        vm.prank(alice);
        jar.tip{value: 1 ether}("thanks");
        vm.prank(bob);
        jar.tip{value: 0.5 ether}("");
        vm.prank(alice);
        jar.tip{value: 0.25 ether}("again");
        assertEq(jar.totalTips(), 1.75 ether);
        assertEq(jar.tipCount(), 3);
        assertEq(jar.tipsBy(alice), 1.25 ether);
        assertEq(jar.tipsBy(bob), 0.5 ether);
        assertEq(address(jar).balance, 1.75 ether);
    }

    function test_tipEmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(jar));
        emit ITipJar.Tipped(alice, 1 ether, "hello");
        vm.prank(alice);
        jar.tip{value: 1 ether}("hello");
    }

    function test_minimumTipIsAccepted() public {
        vm.prank(alice);
        jar.tip{value: 0.001 ether}("");
        assertEq(jar.totalTips(), 0.001 ether);
    }

    function test_tipBelowMinimumReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ITipJar.TipTooSmall.selector, 0.001 ether - 1, 0.001 ether));
        jar.tip{value: 0.001 ether - 1}("");
    }

    function test_noteAtLimitIsAccepted() public {
        vm.prank(alice);
        jar.tip{value: 1 ether}(string(new bytes(140)));
        assertEq(jar.tipCount(), 1);
    }

    function test_noteTooLongReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ITipJar.NoteTooLong.selector, 141));
        jar.tip{value: 1 ether}(string(new bytes(141)));
    }

    function test_tipWhilePausedReverts() public {
        jar.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(ITipJar.JarPaused.selector);
        jar.tip{value: 1 ether}("");
    }

    function test_tipAfterUnpause() public {
        jar.setPaused(true);
        jar.setPaused(false);
        vm.prank(alice);
        jar.tip{value: 1 ether}("");
        assertEq(jar.tipCount(), 1);
    }
}

/// Owner functions: withdraw, pause and ownership.
contract AdminTest is TipJarBase {
    function setUp() public override {
        super.setUp();
        vm.prank(alice);
        jar.tip{value: 2 ether}("seed");
    }

    function test_deployerIsOwner() public view {
        assertEq(jar.owner(), address(this));
        assertFalse(jar.paused());
    }

    function test_withdrawPaysOwner() public {
        uint256 before = address(this).balance;
        vm.expectEmit(true, false, false, true, address(jar));
        emit ITipJar.Withdrawn(address(this), 1.5 ether);
        jar.withdraw(1.5 ether);
        assertEq(address(this).balance, before + 1.5 ether);
        assertEq(address(jar).balance, 0.5 ether);
        assertEq(jar.totalTips(), 2 ether, "withdrawing does not change the tip total");
    }

    function test_withdrawWholeBalance() public {
        jar.withdraw(2 ether);
        assertEq(address(jar).balance, 0);
    }

    function test_withdrawTooMuchReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ITipJar.InsufficientBalance.selector, 2 ether + 1, 2 ether));
        jar.withdraw(2 ether + 1);
    }

    function test_withdrawByOtherReverts() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ITipJar.NotOwner.selector, bob));
        jar.withdraw(1 ether);
    }

    function test_pauseByOtherReverts() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ITipJar.NotOwner.selector, bob));
        jar.setPaused(true);
    }

    function test_pauseEmitsEvent() public {
        vm.expectEmit(false, false, false, true, address(jar));
        emit ITipJar.PausedSet(true);
        jar.setPaused(true);
        assertTrue(jar.paused());
    }

    function test_transferOwnership() public {
        vm.expectEmit(true, true, false, false, address(jar));
        emit ITipJar.OwnershipTransferred(address(this), bob);
        jar.transferOwnership(bob);
        assertEq(jar.owner(), bob);
        vm.expectRevert(abi.encodeWithSelector(ITipJar.NotOwner.selector, address(this)));
        jar.withdraw(1 ether);
        vm.prank(bob);
        jar.withdraw(1 ether);
        assertEq(bob.balance, 11 ether);
    }

    function test_transferToZeroReverts() public {
        vm.expectRevert(ITipJar.ZeroAddress.selector);
        jar.transferOwnership(address(0));
    }
}
