% Sokoban Puzzle Solver with Hint Generation - OPTIMIZED FOR SPEED
% This ASP program solves Sokoban puzzles quickly for hint generation

% ============================================================================
% INPUT FORMAT (provided by the application)
% ============================================================================
% cell(X,Y,Type) - defines the grid (Type: wall | floor | goal)
% initial_player(X,Y) - player's starting position
% initial_box(X,Y) - box's starting position

% ============================================================================
% CONSTANTS - REDUCED FOR PERFORMANCE
% ============================================================================
#const max_steps = 20.  % Reduced from 50 for faster solving

% Directions
direction(up; down; left; right).

% Direction deltas
delta(up, 0, -1).
delta(down, 0, 1).
delta(left, -1, 0).
delta(right, 1, 0).

% ============================================================================
% PRECOMPUTED GRID FACTS - AVOID REDUNDANT CHECKS
% ============================================================================
valid_cell(X, Y) :- cell(X, Y, floor).
valid_cell(X, Y) :- cell(X, Y, goal).

% ============================================================================
% INITIAL STATE (Step 0)
% ============================================================================
player(X, Y, 0) :- initial_player(X, Y).
box(X, Y, 0) :- initial_box(X, Y).

% ============================================================================
% MOVEMENT RULES - SIMPLIFIED
% ============================================================================
% Generate one move per step (optional moves allowed)
{ move(D, T) : direction(D) } <= 1 :- T = 1..max_steps.

% Calculate new player position
new_player_pos(X+DX, Y+DY, D, T) :- 
    player(X, Y, T-1),
    move(D, T),
    delta(D, DX, DY).

% ============================================================================
% MOVEMENT CONSTRAINTS - STREAMLINED
% ============================================================================
% Cannot move into walls
:- new_player_pos(X, Y, _, _), cell(X, Y, wall).

% Cannot move into box unless can push it
:- new_player_pos(X, Y, D, T), 
   box(X, Y, T-1),
   not can_push(X, Y, D, T).

% ============================================================================
% BOX PUSHING - OPTIMIZED
% ============================================================================
% Can push if space behind box is valid and empty
can_push(BX, BY, D, T) :-
    box(BX, BY, T-1),
    delta(D, DX, DY),
    valid_cell(BX+DX, BY+DY),
    not box(BX+DX, BY+DY, T-1).

% Push box when player moves into it
box(BX+DX, BY+DY, T) :-
    new_player_pos(BX, BY, D, T),
    box(BX, BY, T-1),
    delta(D, DX, DY).

% Boxes stay if not pushed (inertia)
box(X, Y, T) :-
    box(X, Y, T-1),
    not new_player_pos(X, Y, _, T),
    T = 1..max_steps.

% ============================================================================
% PLAYER STATE
% ============================================================================
player(X, Y, T) :- new_player_pos(X, Y, _, T).
player(X, Y, T) :- player(X, Y, T-1), not move(_, T), T = 1..max_steps.

% ============================================================================
% GOAL CONDITION - SIMPLIFIED
% ============================================================================
solved(T) :- 
    T = 1..max_steps,
    not unsolved_goal(T).

unsolved_goal(T) :- cell(X, Y, goal), not box(X, Y, T), T = 0..max_steps.

% Must reach solved state
:- not solved(_).

% Stop after solving (pruning)
:- solved(T), move(_, T2), T2 > T.

% ============================================================================
% OPTIMIZATION - MINIMIZE MOVES
% ============================================================================
#minimize { 1,T : move(_, T) }.

% ============================================================================
% OUTPUT
% ============================================================================
#show move/2.

% Debug (optional)
% #show solved/1.
% #show player/3.
% #show box/3.

