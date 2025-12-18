% Sokoban Solver - Optimized

#const max_steps = 50.

direction(0, -1; 0, 1; -1, 0; 1, 0).
dir_name(0, -1, up).
dir_name(0, 1, down).
dir_name(-1, 0, left).
dir_name(1, 0, right).

% Safe dead squares (no false positives).

time(0..max_steps).

walkable(X,Y) :- cell(X,Y,floor).
walkable(X,Y) :- cell(X,Y,goal).

goal(X,Y) :- cell(X,Y,goal).

safe_box(X,Y) :- goal(X,Y).
safe_box(PX,PY) :-
    safe_box(X,Y),
    direction(DX,DY),
    PX = X-DX, PY = Y-DY,
    walkable(PX,PY),
    walkable(PX-DX, PY-DY).

dead(X,Y) :- cell(X,Y,floor), not safe_box(X,Y).

at(X, Y, 0) :- initial_player(X, Y), walkable(X,Y).
box(X, Y, 0) :- initial_box(X, Y), walkable(X,Y).

{ move(DX, DY, T) : direction(DX, DY) } 1 :- time(T), T > 0.

moved(T) :- move(_, _, T).

next_pos(NX, NY, T) :-
    at(X, Y, T-1),
    move(DX, DY, T),
    NX = X+DX, NY = Y+DY,
    walkable(NX, NY).

has_next(T) :- next_pos(_, _, T).
:- moved(T), not has_next(T).

% Box Interaction
% Define when a push happens
push(X, Y, DX, DY, T) :-
    at(X, Y, T-1),
    move(DX, DY, T),
    BX = X+DX, BY = Y+DY,
    box(BX, BY, T-1),
    NX = X+2*DX, NY = Y+2*DY,
    walkable(NX, NY),
    not box(NX, NY, T-1),
    not dead(NX, NY).

% If the next position is occupied by a box, the move must be a valid push
:- move(DX, DY, T),
   at(X, Y, T-1),
   BX = X+DX, BY = Y+DY,
   box(BX, BY, T-1),
   not push(X, Y, DX, DY, T).

% Effect: Box moves
box(NX, NY, T) :-
    push(X, Y, DX, DY, T),
    NX = X+2*DX, NY = Y+2*DY.

% Effect: Box stays (Inertia)
box(X, Y, T) :-
    box(X, Y, T-1),
    not box_moved(X, Y, T),
    time(T), T > 0.
box_moved(BX, BY, T) :-
    push(PX, PY, DX, DY, T),
    BX = PX+DX, BY = PY+DY.

% Effect: Player moves
at(X, Y, T) :- next_pos(X, Y, T).

% (Removed: older conditional-literal constraint; replaced by the push validity constraint above)

% ============================================================================
% HEURISTICS (GOAL DISTANCE)
% ============================================================================
% Compute distance to nearest goal for every cell
% Start at goals
gdist(X, Y, 0) :- cell(X, Y, goal).

% Propagate (BFS)
gdist(X, Y, D+1) :- 
    gdist(NX, NY, D), 
    cell(X, Y, floor), 
    direction(DX, DY), NX=X+DX, NY=Y+DY,
    D < 20, % Limit depth to avoid explosion in large maps
    not gdist(X, Y, D') : D' = 0..D.

gdist(X, Y, D+1) :- 
    gdist(NX, NY, D), 
    cell(X, Y, goal), % Goals are also floor-like
    direction(DX, DY), NX=X+DX, NY=Y+DY,
    D < 20,
    not gdist(X, Y, D') : D' = 0..D.

gdist(X, Y, 21) :- cell(X, Y, _), not gdist(X, Y, D) : D = 0..20. % Unreachable/Far

% ============================================================================
% OPTIMIZATIONS (PRUNING)
% ============================================================================
% 1. Symmetry Breaking: Don't flip-flop
inverse(DX, DY, -DX, -DY) :- direction(DX, DY).
:- move(DX, DY, T), move(PDX, PDY, T-1), 
   inverse(DX, DY, PDX, PDY),
   not push(_, _, _, _, T-1).

% ============================================================================
% MINIMIZATION / SEARCH GUIDANCE
% ============================================================================
% Heuristic: Minimize total moves (Highest Priority - Shortest Path)
#minimize { 1@2, T : move(_,_,T) }.

% Secondary: Minimize sum of distances of boxes to goals (Guide search)
#minimize { D@1, X,Y,T : box(X,Y,T), gdist(X,Y,D) }.

% Finished when ALL boxes are on goals (goals can be >= boxes)
box_off_goal(T) :- time(T), box(X,Y,T), not goal(X,Y).
finished(T) :- time(T), not box_off_goal(T).

:- not finished(max_steps). 

% Output formatting
move(DName, T) :- move(DX, DY, T), dir_name(DX, DY, DName).
#show move/2.
#show push/5.

