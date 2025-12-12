// Database of standard Sokoban Maps with Records
const MAP_DATABASE = [
    {
        id: "d1",
        name: "Microban 1",
        source: "Microban (David W. Skinner)",
        difficulty: "Easy",
        bestSteps: "90 moves",
        worldRecord: 96,
        grid: [
            "####  ",
            "# .#  ",
            "#  ###",
            "#*@  #",
            "#  $ #",
            "#  ###",
            "####  "
        ]
    },
    {
        id: "d2",
        name: "Sasquatch 1",
        source: "Sasquatch",
        difficulty: "Medium",
        bestSteps: "200 moves",
        grid: [
            "  ##  ",
            "###.##",
            "#  * #",
            "# @  #",
            "# $  #",
            "###  #",
            "  ####"
        ]
    },
    {
        id: "d3",
        name: "Classic Level 1",
        source: "Original Boxxle/Sokoban",
        difficulty: "Medium",
        bestSteps: "300 moves",
        grid: [
            "    #####",
            "    #   #",
            "    #$  #",
            "  ###  $##",
            "  #  $ $ #",
            "### # ## #   ######",
            "#   # ## #####  ..#",
            "# $  $          ..#",
            "##### ### #@##  ..#",
            "    #     #########",
            "    #######"
        ]
    },
    {
        id: "d4",
        name: "Mini Cosmos",
        source: "Microban II",
        difficulty: "Easy",
        bestSteps: "35 moves",
        grid: [
            "  ####",
            "###  #",
            "# .  #",
            "#  $ #",
            "# @  #",
            "######"
        ]
    },
    {
        id: "d5",
        name: "The T-Shape",
        source: "Custom",
        difficulty: "Easy",
        bestSteps: "42 moves",
        grid: [
            "#######",
            "#  .  #",
            "#  $  #",
            "# @$  #",
            "#  $  #",
            "#  .  #",
            "#######"
        ]
    },
    {
        id: "d6",
        name: "Box Chamber",
        source: "Classic",
        difficulty: "Medium",
        bestSteps: "60 moves",
        grid: [
            " ######",
            " #    #",
            " # $  #",
            "## $ ##",
            "#  .  #",
            "# .@. #",
            "#######"
        ]
    },
    {
        id: "d7",
        name: "Long Corridor",
        source: "Microban III",
        difficulty: "Easy",
        bestSteps: "28 moves",
        grid: [
            "#########",
            "#   .   #",
            "#   $   #",
            "#   @   #",
            "#########"
        ]
    },
    {
        id: "d8",
        name: "ZigZag Path",
        source: "Custom",
        difficulty: "Medium",
        bestSteps: "85 moves",
        grid: [
            "####  ",
            "#  ####",
            "# $   #",
            "#  #$ #",
            "## .  #",
            " # @  #",
            " ######"
        ]
    },
    {
        id: "d9",
        name: "Square One",
        source: "Simple",
        difficulty: "Easy",
        bestSteps: "20 moves",
        grid: [
            "#####",
            "#   #",
            "#.$.#",
            "# @ #",
            "#####"
        ]
    },
    {
        id: "d10",
        name: "Double Trouble",
        source: "Classic",
        difficulty: "Hard",
        bestSteps: "110 moves",
        grid: [
            "  #### ",
            "###  ##",
            "# .$$ #",
            "#  @  #",
            "###  ##",
            "  #### "
        ]
    },
    {
        id: "d11",
        name: "Pocket",
        source: "Microban",
        difficulty: "Easy",
        bestSteps: "55 moves",
        grid: [
            "  ####",
            "  #  #",
            "###$ #",
            "# .  #",
            "#  @ #",
            "######"
        ]
    },
    {
        id: "d12",
        name: "Twin Rooms",
        source: "Concept",
        difficulty: "Medium",
        bestSteps: "130 moves",
        grid: [
            "#########",
            "#   #   #",
            "# $ # $ #",
            "# . # . #",
            "#   @   #",
            "#########"
        ]
    },
    {
        id: "d13",
        name: "The Cross",
        source: "Custom",
        difficulty: "Medium",
        bestSteps: "92 moves",
        grid: [
            "  ###  ",
            "  #.#  ",
            "###$###",
            "#  $  #",
            "###@###",
            "  # #  ",
            "  ###  "
        ]
    },
    {
        id: "d14",
        name: "Cornered",
        source: "Microban",
        difficulty: "Medium",
        bestSteps: "77 moves",
        grid: [
            "#######",
            "# .   #",
            "#  $  #",
            "# $#$ #",
            "#  @  #",
            "#     #",
            "#######"
        ]
    },
    {
        id: "d15",
        name: "Long Way Home",
        source: "Custom",
        difficulty: "Hard",
        bestSteps: "200+ moves",
        grid: [
            "###########",
            "#    .    #",
            "# ####### #",
            "#    $    #",
            "### ### ###",
            "  # @ #    ",
            "  #####    "
        ]
    },
    {
        id: "d16",
        name: "Blocks",
        source: "Classic",
        difficulty: "Medium",
        bestSteps: "150 moves",
        grid: [
            "######",
            "#    #",
            "# $$ #",
            "# .. #",
            "# @  #",
            "######"
        ]
    },
    {
        id: "d17",
        name: "Pyramid",
        source: "Concept",
        difficulty: "Hard",
        bestSteps: "180 moves",
        grid: [
            "   #   ",
            "  #.#  ",
            " # $ # ",
            "#  $  #",
            "#  @  #",
            "#######"
        ]
    },
    {
        id: "d18",
        name: "Filter",
        source: "Microban",
        difficulty: "Medium",
        bestSteps: "90 moves",
        grid: [
            "########",
            "#  .   #",
            "# $#$  #",
            "#  @   #",
            "########"
        ]
    },
    {
        id: "d19",
        name: "Maze Runner",
        source: "Custom",
        difficulty: "Hard",
        bestSteps: "250 moves",
        grid: [
            "#######",
            "#  #  #",
            "# $#$ #",
            "#. @ .#",
            "# # # #",
            "#     #",
            "#######"
        ]
    },
    {
        id: "d20",
        name: "Final Exam",
        source: "Advanced",
        difficulty: "Hard",
        bestSteps: "Unknown",
        grid: [
            "  ####  ",
            "###  ###",
            "#      #",
            "# $..$ #",
            "#  ##  #",
            "## @  ##",
            "  ####  "
        ]
    }
];

window.MAP_DATABASE = MAP_DATABASE;
