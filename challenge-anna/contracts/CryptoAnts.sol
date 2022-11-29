import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import 'hardhat/console.sol';

interface IEgg is IERC20 {
  function mint(address, uint256) external;
}

interface ICryptoAnts is IERC721 {
  event EggsBought(address, uint256);

  function buyEggs(uint256) external payable;

  error NoEggs();
  event AntSold();
  error NoZeroAddress();
  event AntCreated();
  error AlreadyExists();
  error WrongEtherSent();
}

//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

contract CryptoAnts is ERC721, ICryptoAnts, Ownable, ReentrancyGuard {
  mapping(uint256 => address) public antToOwner;
  mapping(uint256 => uint256) public antToLastTimeEggsCreated;
  IEgg public immutable eggs;
  uint256 public eggPrice = 0.01 ether;
  uint256[] public allAntsIds;
  uint256 public antsCreated = 0;
  uint256 public eggsCreationMaxNumber = 20;
  uint256 public secondsToWaitAfterEggCreation = 600;
  uint256 public chanceOfDying = 5;

  constructor(address _owner, address _eggs) ERC721('Crypto Ants', 'ANTS') {
    _transferOwnership(_owner);
    eggs = IEgg(_eggs);
  }

  function changeEggPrice(uint256 _price) external onlyOwner {
    eggPrice = _price;
  }

  function buyEggs(uint256 _amount) external payable override nonReentrant {
    uint256 eggsCallerCanBuy = (msg.value / eggPrice);
    require(_amount == eggsCallerCanBuy, 'You have to pay for those eggs!');
    eggs.mint(msg.sender, eggsCallerCanBuy);
    emit EggsBought(msg.sender, eggsCallerCanBuy);
  }

  function createEgg(uint256 _antId) external timeElapsedFromEggCreation(secondsToWaitAfterEggCreation, _antId) nonReentrant {
    require(antToOwner[_antId] == msg.sender, 'Unauthorized');

    if (_generateRandomNumber(100) <= chanceOfDying) {
      delete antToOwner[_antId];
      _burn(_antId);
      return;
    }

    uint256 eggsToCreate = _generateRandomNumber(eggsCreationMaxNumber);
    antToLastTimeEggsCreated[_antId] = block.timestamp;
    if (eggsToCreate > 0) {
      eggs.mint(msg.sender, eggsToCreate);
    }
  }

  function createAnt() external nonReentrant {
    if (eggs.balanceOf(msg.sender) < 1) revert NoEggs();
    uint256 _antId = ++antsCreated;
    for (uint256 i = 0; i < allAntsIds.length; i++) {
      if (allAntsIds[i] == _antId) revert AlreadyExists();
    }

    antToOwner[_antId] = msg.sender;
    allAntsIds.push(_antId);

    _mint(msg.sender, _antId);
    emit AntCreated();
  }

  function sellAnt(uint256 _antId) external nonReentrant {
    require(antToOwner[_antId] == msg.sender, 'Unauthorized');
    delete antToOwner[_antId];

    _burn(_antId);

    // solhint-disable-next-line
    (bool success, ) = msg.sender.call{value: 0.004 ether}('');
    require(success, 'Whoops, this call failed!');
  }

  function getContractBalance() public view returns (uint256) {
    return address(this).balance;
  }

  function getAntsCreated() public view returns (uint256) {
    return antsCreated;
  }

  function _generateRandomNumber(uint256 _maxNumber) internal view returns (uint256) {
    uint256 randomNumber = uint256(
      keccak256(
        abi.encodePacked(
          block.difficulty,
          block.timestamp,
          block.coinbase,
          block.gaslimit,
          block.chainid,
          block.basefee,
          block.number,
          antsCreated,
          allAntsIds
        )
      )
    ) % (_maxNumber + 1);
    return randomNumber;
  }

  modifier timeElapsedFromEggCreation(uint256 _seconds, uint256 _antId) {
    require(block.timestamp > antToLastTimeEggsCreated[_antId] + _seconds, 'You have to wait');
    _;
  }
}
