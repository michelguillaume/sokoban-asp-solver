% Sokoban Solver - Slide-based

#const max_steps = 35.

direction(0, -1; 0, 1; -1, 0; 1, 0).
inverse(DX, DY, -DX, -DY) :- direction(DX, DY).

walkable(X,Y) :- cell(X,Y,floor).
walkable(X,Y) :- cell(X,Y,goal).
goal(X,Y) :- cell(X,Y,goal).

% Safe dead squares (no false positives).
safe_box(X,Y) :- goal(X,Y).
safe_box(PX,PY) :-
    safe_box(X,Y),
    direction(DX,DY),
    PX = X-DX, PY = Y-DY,
    walkable(PX,PY),
    walkable(PX-DX, PY-DY).
dead(X,Y) :- cell(X,Y,floor), not safe_box(X,Y).

ok_box_pos(X,Y) :- goal(X,Y).
ok_box_pos(X,Y) :- cell(X,Y,floor), not dead(X,Y).

time(0..max_steps).

at(X, Y, 0) :- initial_player(X, Y), walkable(X,Y).
box(X, Y, 0) :- initial_box(X, Y), walkable(X,Y).

free(X, Y, T) :- time(T), walkable(X, Y), not box(X, Y, T).

reach(X, Y, T) :- at(X, Y, T).
reach(NX, NY, T) :-
    reach(X, Y, T),
    direction(DX, DY),
    NX = X+DX, NY = Y+DY,
    free(NX, NY, T).

% Slide destinations
slide_step(BX, BY, DX, DY, NX, NY, T) :-
    box(BX, BY, T),
    direction(DX, DY),
    NX = BX+DX, NY = BY+DY,
    free(NX, NY, T),
    ok_box_pos(NX, NY).

slide_step(BX, BY, DX, DY, NX2, NY2, T) :-
    slide_step(BX, BY, DX, DY, NX, NY, T),
    NX2 = NX+DX, NY2 = NY+DY,
    free(NX2, NY2, T),
    ok_box_pos(NX2, NY2).

can_slide(BX, BY, DX, DY, NX, NY, T) :-
    time(T), T > 0,
    slide_step(BX, BY, DX, DY, NX, NY, T-1),
    PX = BX-DX, PY = BY-DY,
    reach(PX, PY, T-1),
    free(PX, PY, T-1).

{ do_slide(BX, BY, DX, DY, NX, NY, T) : can_slide(BX, BY, DX, DY, NX, NY, T) } 1 :- time(T), T > 0.

:- do_slide(PBX, PBY, PDX, PDY, PNX, PNY, T-1),
   do_slide(BX, BY, DX, DY, NX, NY, T),
   BX = PNX, BY = PNY,
   inverse(PDX, PDY, DX, DY),
   NX = PBX, NY = PBY.

box(NX, NY, T) :- do_slide(_, _, _, _, NX, NY, T), walkable(NX, NY).

% mark old position as moved (so inertia does not keep it)
moved_box(BX, BY, T) :- do_slide(BX, BY, _, _, _, _, T).

% inertia for other boxes
box(X, Y, T) :-
    box(X, Y, T-1),
    not moved_box(X, Y, T),
    time(T), T > 0.

% player ends just behind the box at the end of the slide
at(PX, PY, T) :-
    do_slide(_, _, DX, DY, NX, NY, T),
    PX = NX-DX, PY = NY-DY,
    walkable(PX, PY).

box_off_goal(T) :- time(T), box(X,Y,T), not goal(X,Y).
finished(T) :- time(T), not box_off_goal(T).

:- not finished(max_steps).

#minimize { 1@2, T : do_slide(_,_,_,_,_,_,T) }.

slide(BX, BY, DX, DY, NX, NY, T) :- do_slide(BX, BY, DX, DY, NX, NY, T).

#show slide/7.


