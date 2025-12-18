% Sokoban solver (move-based)
#const max_steps = 20.

direction(up; down; left; right).

delta(up, 0, -1).
delta(down, 0, 1).
delta(left, -1, 0).
delta(right, 1, 0).

valid_cell(X, Y) :- cell(X, Y, floor).
valid_cell(X, Y) :- cell(X, Y, goal).

player(X, Y, 0) :- initial_player(X, Y).
box(X, Y, 0) :- initial_box(X, Y).

{ move(D, T) : direction(D) } <= 1 :- T = 1..max_steps.

new_player_pos(X+DX, Y+DY, D, T) :- 
    player(X, Y, T-1),
    move(D, T),
    delta(D, DX, DY).

:- new_player_pos(X, Y, _, _), cell(X, Y, wall).

:- new_player_pos(X, Y, D, T), 
   box(X, Y, T-1),
   not can_push(X, Y, D, T).

can_push(BX, BY, D, T) :-
    box(BX, BY, T-1),
    delta(D, DX, DY),
    valid_cell(BX+DX, BY+DY),
    not box(BX+DX, BY+DY, T-1).

box(BX+DX, BY+DY, T) :-
    new_player_pos(BX, BY, D, T),
    box(BX, BY, T-1),
    delta(D, DX, DY).

box(X, Y, T) :-
    box(X, Y, T-1),
    not new_player_pos(X, Y, _, T),
    T = 1..max_steps.

player(X, Y, T) :- new_player_pos(X, Y, _, T).
player(X, Y, T) :- player(X, Y, T-1), not move(_, T), T = 1..max_steps.

solved(T) :- 
    T = 1..max_steps,
    not unsolved_goal(T).

unsolved_goal(T) :- cell(X, Y, goal), not box(X, Y, T), T = 0..max_steps.

:- not solved(_).

:- solved(T), move(_, T2), T2 > T.

#minimize { 1,T : move(_, T) }.

#show move/2.
